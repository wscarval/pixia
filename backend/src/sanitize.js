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
