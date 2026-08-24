import rateLimit from "express-rate-limit";

// Só entra em vigor pra quem "está tentando muito" — o número normal de
// cliques de um usuário real fica bem abaixo disso. Chave por IP (já
// confiável depois do "trust proxy" em server.js apontar só pro Nginx).

// Login/cadastro: protege contra força bruta de senha e enumeração de e-mail.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: "Muitas tentativas. Espere um pouco e tente de novo." },
});

// Verificar senha de sala: cada tentativa testa uma senha, então o limite
// aqui é mais apertado que o de login.
export const roomPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: "Muitas tentativas. Espere um pouco e tente de novo." },
});

// Upload de foto de perfil: cada tentativa manda até 5MB + processa a
// imagem no servidor (sharp), então o limite é bem mais apertado que os de
// cima — não é sobre senha errada, é sobre custo de CPU/disco por chamada.
export const avatarUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: "Muitas tentativas. Espere um pouco e tente de novo." },
});
