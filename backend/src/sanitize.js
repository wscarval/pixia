export function sanitizeClientId(value) {
  const clientId = String(value || "").trim();

  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(clientId)) {
    return null;
  }

  return clientId;
}

export function sanitizeRoomId(value) {
  const roomId = String(value || "").trim();

  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(roomId)) {
    return null;
  }

  return roomId;
}

export function sanitizeName(value) {
  const name = String(value || "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 60);

  return name || null;
}

export function sanitizeRoomName(value) {
  const name = String(value || "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 80);

  return name || null;
}

export function sanitizeMessage(value) {
  const message = String(value || "").trim().slice(0, 2000);
  return message || null;
}

// 4 avatares de gato fixos (1 a 4, ver /public/profiles_cats). Quem não
// manda um válido (visitante anônimo em navegador antigo, por exemplo) cai
// pro fallback aleatório calculado no cliente.
export function sanitizeAvatarId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id >= 1 && id <= 4 ? id : null;
}

// Foto de perfil enviada (só quem tem conta, ver /api/auth/avatar-photo).
// Precisa começar com o caminho servido pelo Nginx pra esse propósito —
// sem essa checagem, alguém poderia mandar uma URL externa qualquer nesse
// campo (rastreamento, imagem imprópria vinda de outra origem etc.).
export function sanitizeAvatarUrl(value) {
  const url = String(value || "").trim();
  return url.startsWith("/uploads/avatars/") && url.length <= 200 ? url : null;
}
