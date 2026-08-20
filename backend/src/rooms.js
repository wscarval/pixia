import crypto from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "./db.js";
import { requireAuth, optionalAuth } from "./auth.js";
import { sanitizeRoomId, sanitizeRoomName } from "./sanitize.js";

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET não configurado.");
}

const MIN_PASSWORD_LENGTH = 6;
const ANONYMOUS_ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ANONYMOUS_ROOMS_PER_IP = 3;
const MAX_ROOMS_PER_ACCOUNT = 10;

function generateSlug() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 12);
}

function publicRoom(room) {
  return {
    id: room.id,
    slug: room.slug,
    name: room.name,
    isPublic: !room.passwordHash,
    createdAt: room.createdAt,
  };
}

function signRoomToken(slug) {
  return jwt.sign({ type: "room-access", roomSlug: slug }, JWT_SECRET, { expiresIn: "10m" });
}

// Usado pelo signaling (server.js) para validar quem tenta entrar numa sala
// privada sem passar de novo pela rota /verify.
export function verifyRoomToken(token, slug) {
  if (!token) return false;

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return payload.type === "room-access" && payload.roomSlug === slug;
  } catch {
    return false;
  }
}

async function hashPasswordOrNull(password) {
  return password ? bcrypt.hash(password, 12) : null;
}

function isExpired(room) {
  return Boolean(room?.expiresAt && room.expiresAt.getTime() < Date.now());
}

// Salas públicas anônimas expiram sozinhas (1 dia) — quando alguém esbarra
// numa já vencida, ela é apagada na hora em vez de esperar um job de limpeza.
// Exportado para o handshake do Socket.IO (server.js) usar a mesma regra
// de expiração ao aceitar entrada numa sala.
export async function findLiveRoomBySlug(slug) {
  const room = await prisma.room.findUnique({ where: { slug } });
  if (!room) return null;

  if (isExpired(room)) {
    await prisma.room.delete({ where: { id: room.id } }).catch(() => {});
    return null;
  }

  return room;
}

const router = Router();

// --- Painel do dono (autenticado) ---

router.get("/", requireAuth, async (req, res) => {
  const rooms = await prisma.room.findMany({
    where: { ownerId: req.user.id },
    orderBy: { createdAt: "desc" },
  });

  res.json({ ok: true, rooms: rooms.map(publicRoom) });
});

// Sem login: cria uma sala pública "rápida", sem dono, que não aparece em
// painel nenhum e expira sozinha em 1 dia. Com login: a sala fica associada
// à conta, aparece no painel de links, nunca expira, e só quem está logado
// pode torná-la particular (com senha) — isso cria o motivo pra criar conta.
// Em ambos os casos o slug é sempre gerado pelo servidor.
router.post("/", optionalAuth, async (req, res) => {
  const name = sanitizeRoomName(req.body?.name);
  const password = String(req.body?.password || "");

  if (password && !req.user) {
    res.status(401).json({
      ok: false,
      message: "Faça login para criar uma sala particular.",
    });
    return;
  }

  if (password && password.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({
      ok: false,
      message: `A senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    });
    return;
  }

  if (req.user) {
    // Conta logada: até 10 salas no total (públicas ou particulares),
    // contadas mesmo se já expiraram (só quem é anônimo expira sozinho).
    const ownedCount = await prisma.room.count({ where: { ownerId: req.user.id } });
    if (ownedCount >= MAX_ROOMS_PER_ACCOUNT) {
      res.status(429).json({
        ok: false,
        message: `Você já atingiu o limite de ${MAX_ROOMS_PER_ACCOUNT} salas por conta. Exclua uma no painel para criar outra.`,
      });
      return;
    }
  } else {
    // Anônimo: até 3 salas públicas ativas por IP (as que já expiraram não contam).
    const clientIp = req.ip;
    const activeCount = await prisma.room.count({
      where: {
        creatorIp: clientIp,
        ownerId: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (activeCount >= MAX_ANONYMOUS_ROOMS_PER_IP) {
      res.status(429).json({
        ok: false,
        message: `Limitamos a criação máxima de ${MAX_ANONYMOUS_ROOMS_PER_IP} salas públicas por IP. Crie uma conta e crie até 10 salas.`,
      });
      return;
    }
  }

  const passwordHash = await hashPasswordOrNull(password);

  let room = null;
  for (let attempt = 0; attempt < 5 && !room; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      room = await prisma.room.create({
        data: {
          id: crypto.randomUUID(),
          slug: generateSlug(),
          name,
          passwordHash,
          ownerId: req.user?.id ?? null,
          expiresAt: req.user ? null : new Date(Date.now() + ANONYMOUS_ROOM_TTL_MS),
          creatorIp: req.user ? null : req.ip,
        },
      });
    } catch (error) {
      if (error.code !== "P2002") throw error;
    }
  }

  if (!room) {
    res.status(500).json({ ok: false, message: "Não foi possível gerar um link único. Tente de novo." });
    return;
  }

  res.status(201).json({
    ok: true,
    room: publicRoom(room),
    // Quem acabou de criar a sala já "sabe" a senha — evita pedir de novo
    // na sequência ao entrar.
    roomToken: passwordHash ? signRoomToken(room.slug) : null,
  });
});

router.delete("/:id", requireAuth, async (req, res) => {
  const room = await prisma.room.findUnique({ where: { id: req.params.id } });

  if (!room || room.ownerId !== req.user.id) {
    res.status(404).json({ ok: false, message: "Link não encontrado." });
    return;
  }

  await prisma.room.delete({ where: { id: room.id } });
  res.json({ ok: true });
});

router.put("/:id/password", requireAuth, async (req, res) => {
  const room = await prisma.room.findUnique({ where: { id: req.params.id } });

  if (!room || room.ownerId !== req.user.id) {
    res.status(404).json({ ok: false, message: "Link não encontrado." });
    return;
  }

  const password = String(req.body?.password || "");

  if (password && password.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({
      ok: false,
      message: `A senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    });
    return;
  }

  const updated = await prisma.room.update({
    where: { id: room.id },
    data: { passwordHash: await hashPasswordOrNull(password) },
  });

  res.json({ ok: true, room: publicRoom(updated) });
});

// --- Rotas públicas, usadas ao abrir um link de sala ---

router.get("/:slug/info", async (req, res) => {
  const slug = sanitizeRoomId(req.params.slug);
  const room = slug ? await findLiveRoomBySlug(slug) : null;

  res.json({
    ok: true,
    exists: Boolean(room),
    requiresPassword: Boolean(room?.passwordHash),
    name: room?.name || null,
  });
});

router.post("/:slug/verify", async (req, res) => {
  const slug = sanitizeRoomId(req.params.slug);
  const room = slug ? await findLiveRoomBySlug(slug) : null;

  if (!room || !room.passwordHash) {
    res.json({ ok: true, requiresPassword: false, name: room?.name || null });
    return;
  }

  const password = String(req.body?.password || "");
  const valid = await bcrypt.compare(password, room.passwordHash);

  if (!valid) {
    res.status(401).json({ ok: false, requiresPassword: true, message: "Senha incorreta." });
    return;
  }

  res.json({
    ok: true,
    requiresPassword: true,
    roomToken: signRoomToken(slug),
    name: room.name,
  });
});

export default router;
