import http from "node:http";
import crypto from "node:crypto";
import express from "express";
import { Server } from "socket.io";
import authRouter from "./auth.js";
import roomsRouter, { verifyRoomToken, findLiveRoomBySlug } from "./rooms.js";
import prisma from "./db.js";
import { sanitizeRoomId, sanitizeName, sanitizeMessage, sanitizeAvatarId } from "./sanitize.js";

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 3001);

app.disable("x-powered-by");
// Sempre atrás do Nginx (e da Cloudflare, em produção): confia no
// X-Forwarded-For pra req.ip refletir o IP real de quem acessa, não o do
// proxy. Usado pro limite de salas públicas por IP em rooms.js.
app.set("trust proxy", true);
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

const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean)
  : true;

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

async function getRoomParticipants(roomId, ignoreSocketId = null) {
  const sockets = await io.in(roomId).fetchSockets();

  return sockets
    .filter((client) => client.id !== ignoreSocketId)
    .map((client) => ({
      id: client.id,
      name: client.data.name || "Usuário",
      avatarId: client.data.avatarId || null,
      micEnabled: Boolean(client.data.micEnabled),
      screenSharing: Boolean(client.data.screenSharing),
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

      const existingParticipants = await getRoomParticipants(roomId, socket.id);

      socket.data.roomId = roomId;
      socket.data.roomDbId = persistedRoom.id;
      socket.data.roomIsPrivate = Boolean(persistedRoom.passwordHash);
      socket.data.name = name;
      // Da conta (se logado) ou sorteado no cliente (se anônimo) — o
      // servidor só repassa pros outros participantes, não decide o valor.
      socket.data.avatarId = sanitizeAvatarId(payload.avatarId);
      socket.data.micEnabled = false;
      socket.data.screenSharing = false;

      await socket.join(roomId);

      // Salas particulares guardam o histórico de chat no banco (ver
      // chat-message abaixo) justamente para poder devolvê-lo aqui e não
      // perder as mensagens quando alguém recarrega a página.
      const chatHistory = socket.data.roomIsPrivate
        ? await prisma.chatMessage.findMany({
            where: { roomId: persistedRoom.id },
            orderBy: { createdAt: "asc" },
            take: 200,
          })
        : null;

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
        micEnabled: false,
        screenSharing: false,
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

  socket.on("media-state", ({ micEnabled, screenSharing } = {}) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    if (typeof micEnabled === "boolean") {
      socket.data.micEnabled = micEnabled;
    }

    if (typeof screenSharing === "boolean") {
      socket.data.screenSharing = screenSharing;
    }

    socket.to(roomId).emit("media-state", {
      id: socket.id,
      micEnabled: Boolean(socket.data.micEnabled),
      screenSharing: Boolean(socket.data.screenSharing),
    });
  });

  socket.on("chat-message", async ({ message } = {}) => {
    const roomId = socket.data.roomId;
    const cleanMessage = sanitizeMessage(message);

    if (!roomId || !cleanMessage) return;

    const userName = socket.data.name || "Usuário";

    io.to(roomId).emit("chat-message", {
      id: crypto.randomUUID(),
      userId: socket.id,
      user: userName,
      message: cleanMessage,
      timestamp: new Date().toISOString(),
    });

    // Só salas particulares guardam histórico (ver join-room acima).
    if (socket.data.roomIsPrivate && socket.data.roomDbId) {
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
