import http from "node:http";
import crypto from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import authRouter from "./auth.js";
import roomsRouter, { verifyRoomToken, findLiveRoomBySlug, recordRoomVisit } from "./rooms.js";
import { setIo } from "./presence.js";
import prisma from "./db.js";
import {
  sanitizeRoomId,
  sanitizeName,
  sanitizeMessage,
  sanitizeAvatarId,
  sanitizeAvatarUrl,
  sanitizeClientId,
} from "./sanitize.js";

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 3001);

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET não configurado.");
}

// Extrai o id da conta de um token de login (mesmo formato emitido em
// auth.js), sem bater no banco — só confere a assinatura, igual
// verifyRoomToken em rooms.js. null pra visitante anônimo ou token
// ausente/inválido/expirado (sem lançar erro, entra como anônimo mesmo).
function verifyAccountToken(token) {
  if (!token) return null;

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

app.disable("x-powered-by");
// Confia em exatamente 1 hop de proxy (o Nginx, único jeito de chegar aqui
// já que o backend não publica porta no host). Com "true" (todos os hops),
// o Express usa o primeiro IP da cadeia X-Forwarded-For — e esse primeiro
// valor pode ser forjado por quem manda a requisição, já que o Nginx só
// *acrescenta* o IP de quem conecta nele, sem apagar o que já veio no
// cabeçalho. Com "1", ele usa o IP que o próprio Nginx acrescentou (a
// conexão real), ignorando qualquer coisa que o cliente tenha inventado.
app.set("trust proxy", 1);
app.use(express.json({ limit: "64kb" }));

app.use("/api/auth", authRouter);
app.use("/api/rooms", roomsRouter);

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "webrtc-signaling",
    timestamp: new Date().toISOString(),
  });
});

const TURN_SECRET = process.env.TURN_SECRET;
const TURN_URL = process.env.TURN_URL;
const TURN_TTL_SECONDS = 3600;

// Manda UDP e TCP pro mesmo host:porta, não só UDP. Rede restritiva de
// verdade (corporativa, algumas de operadora móvel) costuma bloquear UDP de
// saída inteiro mas deixa passar TCP — sem essa segunda opção, quem estiver
// numa rede assim nunca consegue nem tentar o TURN, só falha direto.
function turnUrlVariants(baseUrl) {
  const withoutQuery = baseUrl.split("?")[0];
  return [`${withoutQuery}?transport=udp`, `${withoutQuery}?transport=tcp`];
}

// Credencial de TURN de curta duração (esquema "REST API" do coturn: usuário
// é o timestamp de expiração, senha é HMAC-SHA1 disso com um segredo
// compartilhado só entre backend e coturn). Em vez de uma credencial fixa
// embutida pra sempre no bundle do cliente, essa aqui expira sozinha.
app.get("/api/turn-credentials", (_req, res) => {
  if (!TURN_SECRET || !TURN_URL) {
    res.status(503).json({ ok: false, message: "TURN não configurado." });
    return;
  }

  const expiry = Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS;
  const username = String(expiry);
  const credential = crypto.createHmac("sha1", TURN_SECRET).update(username).digest("base64");

  res.json({
    ok: true,
    urls: turnUrlVariants(TURN_URL),
    username,
    credential,
    ttl: TURN_TTL_SECONDS,
  });
});

// Sem CORS_ORIGIN configurado, fecha por padrão (nenhuma origem cruzada
// permitida) em vez de liberar geral: o próprio app sempre fala com o
// Socket.IO pela mesma origem (via Nginx), então isso não quebra o uso
// normal — só impede que qualquer outro site abra conexões pra cá.
const configuredCorsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean)
  : [];

if (configuredCorsOrigins.length === 0) {
  console.warn(
    "[cors] CORS_ORIGIN não configurado: conexões de outras origens ficam bloqueadas por padrão. " +
      "Defina CORS_ORIGIN=https://seu-dominio.com no .env se precisar liberar alguma."
  );
}

const corsOrigin = configuredCorsOrigins.length > 0 ? configuredCorsOrigins : false;

const io = new Server(server, {
  path: "/socket.io",
  cors: {
    origin: corsOrigin,
    credentials: true,
  },
  transports: ["websocket", "polling"],
  pingInterval: 25000,
  pingTimeout: 20000,
});

setIo(io);

// Numa conexão instável, o socket.io do cliente reconecta sozinho (novo
// socket.id) bem antes do servidor perceber que o socket antigo morreu: o
// heartbeat só desiste depois de pingInterval + pingTimeout (até 45s aqui).
// Nesse meio tempo, a mesma aba aparece na sala duas vezes (a antiga
// zumbi + a nova). Esse mapa rastreia "essa aba (clientId) já tem um
// socket nessa sala?" pra derrubar o antigo na hora, assim que o novo
// chega, em vez de esperar o timeout.
const roomClientSockets = new Map();

function roomClientKey(roomId, clientId) {
  return roomId && clientId ? `${roomId}:${clientId}` : null;
}

// Mesma ideia do mapa acima, mas pra "essa CONTA já tem um socket nessa
// sala?" em vez de "essa ABA". clientId sozinho não pega o caso de alguém
// abrir várias abas de propósito (cada aba tem um clientId novo, então
// nenhuma delas parece uma reconexão) — seriam vários "clones" da mesma
// pessoa na lista de participantes. Só existe pra quem está logado: é a
// única identidade que dá pra confirmar de verdade (assinatura do JWT), sem
// isso um visitante anônimo não tem como provar "sou a mesma pessoa da
// outra aba" com segurança.
const roomAccountSockets = new Map();

function roomAccountKey(roomId, accountUserId) {
  return roomId && accountUserId ? `${roomId}:${accountUserId}` : null;
}

// Limite de mensagens por socket (não por IP: cada conexão já representa um
// participante numa sala). Evita inundar a sala de mensagens e, pra salas
// particulares, evita amplificar isso em escritas no banco.
const CHAT_RATE_LIMIT = 10;
const CHAT_RATE_WINDOW_MS = 10_000;

function isChatRateLimited(socket) {
  const now = Date.now();
  const recent = (socket.data.chatTimestamps || []).filter(
    (timestamp) => now - timestamp < CHAT_RATE_WINDOW_MS
  );

  if (recent.length >= CHAT_RATE_LIMIT) {
    socket.data.chatTimestamps = recent;
    return true;
  }

  recent.push(now);
  socket.data.chatTimestamps = recent;
  return false;
}

async function getRoomParticipants(roomId, ignoreSocketId = null) {
  const sockets = await io.in(roomId).fetchSockets();

  return sockets
    .filter((client) => client.id !== ignoreSocketId)
    .map((client) => ({
      id: client.id,
      name: client.data.name || "Usuário",
      avatarId: client.data.avatarId || null,
      avatarUrl: client.data.avatarUrl || null,
      micEnabled: Boolean(client.data.micEnabled),
      screenSharing: Boolean(client.data.screenSharing),
      deafened: Boolean(client.data.deafened),
    }));
}

io.on("connection", (socket) => {
  console.log(`[socket] conectado ${socket.id}`);

  socket.on("join-room", async (payload = {}, callback = () => {}) => {
    try {
      const roomId = sanitizeRoomId(payload.roomId);
      const name = sanitizeName(payload.name);

      if (!roomId || !name) {
        callback({
          ok: false,
          message: "Sala ou nome inválido.",
        });
        return;
      }

      // Salas são sempre criadas pelo servidor (POST /api/rooms) — ninguém
      // entra num roomId que não exista, mesmo digitando um /r/<algo>
      // qualquer na URL. Salas públicas anônimas também expiram em 1 dia.
      const persistedRoom = await findLiveRoomBySlug(roomId);

      if (!persistedRoom) {
        callback({ ok: false, message: "Esta sala não existe." });
        return;
      }

      // Salas com senha só aceitam quem já validou via
      // POST /api/rooms/:slug/verify e trouxe o roomToken correspondente.
      if (persistedRoom.passwordHash && !verifyRoomToken(payload.roomToken, roomId)) {
        callback({
          ok: false,
          requiresPassword: true,
          message: "Esta sala é privada. Informe a senha para entrar.",
        });
        return;
      }

      // Caso o socket já esteja em outra sala da aplicação.
      if (socket.data.roomId && socket.data.roomId !== roomId) {
        await socket.leave(socket.data.roomId);
      }

      // Reconexão da mesma aba (mesmo clientId) numa rede instável: o
      // socket antigo ainda pode estar "vivo" pro servidor (heartbeat não
      // estourou ainda). Derruba ele agora, antes de montar a lista de
      // participantes, pra ninguém ver a mesma pessoa duas vezes.
      const clientId = sanitizeClientId(payload.clientId);
      const dedupeKey = roomClientKey(roomId, clientId);
      if (dedupeKey) {
        const staleSocketId = roomClientSockets.get(dedupeKey);
        if (staleSocketId && staleSocketId !== socket.id) {
          io.sockets.sockets.get(staleSocketId)?.disconnect(true);
          if (roomClientSockets.get(dedupeKey) === staleSocketId) {
            roomClientSockets.delete(dedupeKey);
          }
        }
      }

      // Mesma conta logada abrindo uma segunda aba/janela nessa sala: aqui
      // não é reconexão (clientId é outro), é a mesma pessoa de propósito.
      // Derruba a aba antiga — a nova "assume" a presença na sala, como a
      // maioria dos apps de chamada faz.
      const accountUserId = verifyAccountToken(payload.accountToken);
      const accountKey = roomAccountKey(roomId, accountUserId);
      if (accountKey) {
        const staleSocketId = roomAccountSockets.get(accountKey);
        if (staleSocketId && staleSocketId !== socket.id) {
          io.sockets.sockets.get(staleSocketId)?.disconnect(true);
          if (roomAccountSockets.get(accountKey) === staleSocketId) {
            roomAccountSockets.delete(accountKey);
          }
        }
      }

      const existingParticipants = await getRoomParticipants(roomId, socket.id);

      socket.data.roomId = roomId;
      socket.data.roomDbId = persistedRoom.id;
      socket.data.name = name;
      socket.data.clientId = clientId;
      socket.data.accountUserId = accountUserId;
      // Da conta (se logado) ou sorteado no cliente (se anônimo) — o
      // servidor só repassa pros outros participantes, não decide o valor.
      socket.data.avatarId = sanitizeAvatarId(payload.avatarId);
      // Só quem está logado e enviou uma foto tem isso preenchido; visitante
      // anônimo cai pro avatarId acima.
      socket.data.avatarUrl = sanitizeAvatarUrl(payload.avatarUrl);
      socket.data.micEnabled = false;
      socket.data.screenSharing = false;
      socket.data.deafened = false;

      await socket.join(roomId);
      if (dedupeKey) {
        roomClientSockets.set(dedupeKey, socket.id);
      }
      if (accountKey) {
        roomAccountSockets.set(accountKey, socket.id);
      }
      // Não bloqueia o join: só alimenta "Salas Acessadas Anteriormente"
      // no painel/tela inicial, não é crítico pro caminho de entrar na sala.
      if (accountUserId) {
        recordRoomVisit(accountUserId, persistedRoom.id).catch((error) => {
          console.error("[join-room] falha ao registrar visita", error);
        });
      }
      // Toda sala guarda o histórico de chat no banco (ver chat-message
      // abaixo), pública/anônima ou não — assim ninguém perde as mensagens
      // ao recarregar a página. Some sozinho quando a sala é apagada (cascade
      // no schema), inclusive salas anônimas expiradas em 24h.
      const chatHistory = await prisma.chatMessage.findMany({
        where: { roomId: persistedRoom.id },
        orderBy: { createdAt: "asc" },
        take: 200,
      });

      callback({
        ok: true,
        selfId: socket.id,
        participants: existingParticipants,
        messages: chatHistory
          ? chatHistory.map((item) => ({
              id: item.id,
              userId: null,
              user: item.userName,
              message: item.message,
              timestamp: item.createdAt.toISOString(),
            }))
          : undefined,
      });

      socket.to(roomId).emit("user-joined", {
        id: socket.id,
        name,
        avatarId: socket.data.avatarId,
        avatarUrl: socket.data.avatarUrl,
        micEnabled: false,
        screenSharing: false,
        deafened: false,
      });

      console.log(`[room:${roomId}] ${name} entrou (${socket.id})`);
    } catch (error) {
      console.error("[join-room]", error);
      callback({ ok: false, message: "Não foi possível entrar na sala." });
    }
  });

  socket.on("signal", ({ to, description, candidate } = {}) => {
    if (!to || !socket.data.roomId) return;

    const target = io.sockets.sockets.get(to);
    if (!target) return;

    // Evita signaling entre participantes de salas diferentes.
    if (target.data.roomId !== socket.data.roomId) return;

    io.to(to).emit("signal", {
      from: socket.id,
      description: description || null,
      candidate: candidate || null,
    });
  });

  // Só um "eco" pro cliente medir o round-trip até o servidor de sinalização
  // (usado pra mostrar ping/saúde da conexão na sala).
  socket.on("ping-check", (callback = () => {}) => {
    callback();
  });

  socket.on("media-state", ({ micEnabled, screenSharing, deafened } = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    if (typeof micEnabled === "boolean") {
      socket.data.micEnabled = micEnabled;
    }

    if (typeof screenSharing === "boolean") {
      socket.data.screenSharing = screenSharing;
    }

    if (typeof deafened === "boolean") {
      socket.data.deafened = deafened;
    }

    socket.to(roomId).emit("media-state", {
      id: socket.id,
      micEnabled: Boolean(socket.data.micEnabled),
      screenSharing: Boolean(socket.data.screenSharing),
      deafened: Boolean(socket.data.deafened),
    });
  });

  socket.on("chat-message", async ({ message } = {}) => {
    const roomId = socket.data.roomId;
    const cleanMessage = sanitizeMessage(message);

    if (!roomId || !cleanMessage) return;
    if (isChatRateLimited(socket)) return;

    const userName = socket.data.name || "Usuário";

    io.to(roomId).emit("chat-message", {
      id: crypto.randomUUID(),
      userId: socket.id,
      user: userName,
      message: cleanMessage,
      timestamp: new Date().toISOString(),
    });

    // Toda sala guarda histórico agora (ver join-room acima).
    if (socket.data.roomDbId) {
      try {
        await prisma.chatMessage.create({
          data: {
            roomId: socket.data.roomDbId,
            userName,
            message: cleanMessage,
          },
        });
      } catch (error) {
        console.error("[chat-message] falha ao salvar histórico", error);
      }
    }
  });

  socket.on("disconnecting", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const dedupeKey = roomClientKey(roomId, socket.data.clientId);
    if (dedupeKey && roomClientSockets.get(dedupeKey) === socket.id) {
      roomClientSockets.delete(dedupeKey);
    }

    const accountKey = roomAccountKey(roomId, socket.data.accountUserId);
    if (accountKey && roomAccountSockets.get(accountKey) === socket.id) {
      roomAccountSockets.delete(accountKey);
    }

    socket.to(roomId).emit("user-left", {
      id: socket.id,
    });

    console.log(`[room:${roomId}] ${socket.data.name || socket.id} saiu`);
  });

  socket.on("disconnect", (reason) => {
    console.log(`[socket] desconectado ${socket.id}: ${reason}`);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Signaling WebRTC disponível na porta ${PORT}`);
});
