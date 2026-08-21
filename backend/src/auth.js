import crypto from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "./db.js";
import { sanitizeAvatarId } from "./sanitize.js";
import { authLimiter } from "./rateLimit.js";

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET não configurado.");
}

// bcryptjs é puro JS (sem binding nativo), então roda no mesmo thread do
// event loop do Node: cada hash trava a resposta de TODO mundo conectado
// (incluindo o ping/sinalização WebRTC de outras salas) pelo tempo que leva
// pra calcular. Custo 10 já é o mínimo recomendado pelo OWASP e cai pra 1/4
// do tempo de bloqueio do custo 12 (cada +1 dobra o trabalho).
const BCRYPT_COST = 10;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_NAME_LENGTH = 4;
const MIN_PASSWORD_LENGTH = 6;
// Fotos de perfil fixas: 4 gatinhos em /public/profiles_cats, escolhidos por
// índice (1 a 4). Sem upload, é só um seletor.
const AVATAR_COUNT = 4;

function randomAvatarId() {
  return Math.floor(Math.random() * AVATAR_COUNT) + 1;
}

function sanitizeName(value) {
  const name = String(value || "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 60);

  return name || null;
}

function sanitizeEmail(value) {
  const email = String(value || "").trim().toLowerCase().slice(0, 190);
  return EMAIL_REGEX.test(email) ? email : null;
}

function issueToken(user) {
  return jwt.sign({ sub: user.id, name: user.name, email: user.email }, JWT_SECRET, {
    expiresIn: "30d",
  });
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, avatarId: user.avatarId };
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    res.status(401).json({ ok: false, message: "Não autenticado." });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });

    if (!user) {
      res.status(401).json({ ok: false, message: "Não autenticado." });
      return;
    }

    req.user = user;
    next();
  } catch {
    res.status(401).json({ ok: false, message: "Sessão inválida ou expirada." });
  }
}

// Como requireAuth, mas nunca bloqueia: se não houver token (ou ele for
// inválido), segue em frente sem req.user — usado em rotas que funcionam
// tanto para visitantes anônimos quanto para usuários logados.
export async function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme === "Bearer" && token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (user) req.user = user;
    } catch {
      // token ausente/expirado: segue anônimo, sem erro.
    }
  }

  next();
}

const router = Router();

router.post("/register", authLimiter, async (req, res) => {
  const name = sanitizeName(req.body?.name);
  const email = sanitizeEmail(req.body?.email);
  const password = String(req.body?.password || "");

  if (!name || name.length < MIN_NAME_LENGTH) {
    res.status(400).json({
      ok: false,
      message: `O nome precisa ter mais de ${MIN_NAME_LENGTH - 1} caracteres.`,
    });
    return;
  }

  if (!email) {
    res.status(400).json({ ok: false, message: "Informe um e-mail válido." });
    return;
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({
      ok: false,
      message: `A senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    });
    return;
  }

  // Mensagem genérica de propósito (não "já existe uma conta com este
  // e-mail"): isso deixaria qualquer um descobrir, e-mail por e-mail, quem
  // tem conta aqui. O bcrypt.hash roda mesmo quando o e-mail já existe pelo
  // mesmo motivo — é a parte mais lenta do caminho de sucesso, então pular
  // ela só no caso "já existe" vazaria a mesma informação pelo tempo de
  // resposta.
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await bcrypt.hash(password, BCRYPT_COST);
    res.status(409).json({ ok: false, message: "Não foi possível criar a conta." });
    return;
  }

  let user;
  try {
    user = await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        name,
        email,
        passwordHash: await bcrypt.hash(password, BCRYPT_COST),
        avatarId: randomAvatarId(),
      },
    });
  } catch (error) {
    if (error.code === "P2002") {
      res.status(409).json({ ok: false, message: "Não foi possível criar a conta." });
      return;
    }
    throw error;
  }

  res.status(201).json({ ok: true, token: issueToken(user), user: publicUser(user) });
});

router.post("/login", authLimiter, async (req, res) => {
  const email = sanitizeEmail(req.body?.email);
  const password = String(req.body?.password || "");

  const user = email ? await prisma.user.findUnique({ where: { email } }) : null;
  const valid = user ? await bcrypt.compare(password, user.passwordHash) : false;

  if (!user || !valid) {
    res.status(401).json({ ok: false, message: "E-mail ou senha inválidos." });
    return;
  }

  res.json({ ok: true, token: issueToken(user), user: publicUser(user) });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ ok: true, user: publicUser(req.user) });
});

router.put("/me", requireAuth, async (req, res) => {
  const name = sanitizeName(req.body?.name);

  if (!name || name.length < MIN_NAME_LENGTH) {
    res.status(400).json({
      ok: false,
      message: `O nome precisa ter mais de ${MIN_NAME_LENGTH - 1} caracteres.`,
    });
    return;
  }

  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data: { name },
  });

  res.json({ ok: true, user: publicUser(updated) });
});

router.put("/avatar", requireAuth, async (req, res) => {
  const avatarId = sanitizeAvatarId(req.body?.avatarId);

  if (!avatarId) {
    res.status(400).json({ ok: false, message: "Escolha um dos avatares disponíveis." });
    return;
  }

  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data: { avatarId },
  });

  res.json({ ok: true, user: publicUser(updated) });
});

router.put("/password", requireAuth, authLimiter, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || "");
  const newPassword = String(req.body?.newPassword || "");

  const valid = await bcrypt.compare(currentPassword, req.user.passwordHash);
  if (!valid) {
    res.status(401).json({ ok: false, message: "Senha atual incorreta." });
    return;
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({
      ok: false,
      message: `A nova senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    });
    return;
  }

  await prisma.user.update({
    where: { id: req.user.id },
    data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_COST) },
  });

  res.json({ ok: true });
});

export default router;
