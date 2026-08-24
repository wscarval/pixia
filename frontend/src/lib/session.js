// Sessão de conta (separada da entrada anônima em salas, que continua
// funcionando sem login). Guarda token/usuário no localStorage e oferece um
// fetch já autenticado para as rotas de /api/rooms.

export function getToken() {
  return localStorage.getItem("webrtc-token") || null;
}

// Identifica esse NAVEGADOR (não essa aba, ver clientId em useRoomWebRTC;
// não essa conta) de forma estável entre sessões — só usado pra dar a quem
// não tem conta algo estável o suficiente pra um banimento de sala segurar
// (ver RoomBan no backend). Gerado uma vez e reaproveitado depois.
const GUEST_ID_KEY = "pixia-guest-id";

export function getGuestId() {
  try {
    let guestId = localStorage.getItem(GUEST_ID_KEY);
    if (!guestId) {
      guestId = crypto.randomUUID().replaceAll("-", "");
      localStorage.setItem(GUEST_ID_KEY, guestId);
    }
    return guestId;
  } catch {
    // localStorage indisponível: sem persistência entre sessões, mas não
    // trava o join por causa disso.
    return crypto.randomUUID().replaceAll("-", "");
  }
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem("webrtc-user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(token, user) {
  localStorage.setItem("webrtc-token", token);
  localStorage.setItem("webrtc-user", JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem("webrtc-token");
  localStorage.removeItem("webrtc-user");
}

// Atualiza só os dados do usuário (ex: depois de trocar o nome), sem mexer
// no token, que continua válido.
export function updateStoredUser(user) {
  localStorage.setItem("webrtc-user", JSON.stringify(user));
}

export async function authFetch(url, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => null);
  return { response, data };
}

// Sessão de "já entrei nesta sala" (nome + token de sala, se privada), uma
// por roomId. Permite recarregar a página e voltar direto pra sala em vez de
// cair na tela de nome de novo.
const ROOM_SESSION_KEY = "pixia-room-sessions";

function readRoomSessions() {
  try {
    return JSON.parse(localStorage.getItem(ROOM_SESSION_KEY) || "{}");
  } catch {
    return {};
  }
}

export function getRoomSession(roomId) {
  return readRoomSessions()[roomId] || null;
}

export function saveRoomSession(roomId, name, roomToken) {
  const sessions = readRoomSessions();
  sessions[roomId] = { name, roomToken: roomToken || null };
  try {
    localStorage.setItem(ROOM_SESSION_KEY, JSON.stringify(sessions));
  } catch {
    // localStorage indisponível, sem problema, só não sobrevive ao reload.
  }
}

export function clearRoomSession(roomId) {
  const sessions = readRoomSessions();
  delete sessions[roomId];
  localStorage.setItem(ROOM_SESSION_KEY, JSON.stringify(sessions));
}
