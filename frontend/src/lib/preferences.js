// Preferências simples do usuário (microfone, mute e volume por pessoa),
// guardadas no localStorage para sobreviver a um F5. Nada aqui é sensível,
// então não precisa passar por auth nem por servidor.

const KEY = "pixia-preferences";

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

function writeAll(prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // localStorage indisponível (modo privado, quota cheia etc), sem problema.
  }
}

function normalizeName(name) {
  return String(name || "").trim().toLowerCase();
}

export function getPreferredAudioInputId() {
  return readAll().audioInputId || "";
}

export function setPreferredAudioInputId(deviceId) {
  const prefs = readAll();
  prefs.audioInputId = deviceId || "";
  writeAll(prefs);
}

export function getPreferredMicEnabled() {
  return Boolean(readAll().micEnabled);
}

export function setPreferredMicEnabled(enabled) {
  const prefs = readAll();
  prefs.micEnabled = Boolean(enabled);
  writeAll(prefs);
}

const SCREEN_QUALITY_IDS = ["720p30", "1080p60", "1440p60"];

export function getPreferredScreenQuality() {
  const value = readAll().screenQuality;
  return SCREEN_QUALITY_IDS.includes(value) ? value : "720p30";
}

export function setPreferredScreenQuality(quality) {
  const prefs = readAll();
  prefs.screenQuality = SCREEN_QUALITY_IDS.includes(quality) ? quality : "720p30";
  writeAll(prefs);
}

// Perfil de qualidade (nitidez x fluidez) — ver SCREEN_SHARE_MODES em
// useRoomWebRTC.js. Independente da resolução acima.
const SCREEN_SHARE_MODE_IDS = ["auto", "detail", "motion"];

export function getPreferredScreenShareMode() {
  const value = readAll().screenShareMode;
  return SCREEN_SHARE_MODE_IDS.includes(value) ? value : "auto";
}

export function setPreferredScreenShareMode(mode) {
  const prefs = readAll();
  prefs.screenShareMode = SCREEN_SHARE_MODE_IDS.includes(mode) ? mode : "auto";
  writeAll(prefs);
}

export function getPreferredScreenShareVolume() {
  const value = readAll().screenShareVolume;
  return typeof value === "number" && value >= 0 && value <= 1 ? value : 1;
}

export function setPreferredScreenShareVolume(volume) {
  const prefs = readAll();
  prefs.screenShareVolume = Math.min(1, Math.max(0, volume));
  writeAll(prefs);
}

export function getStoredParticipantVolume(name) {
  const volumes = readAll().participantVolumes || {};
  const key = normalizeName(name);
  return key in volumes ? volumes[key] : null;
}

export function setStoredParticipantVolume(name, volume) {
  const key = normalizeName(name);
  if (!key) return;

  const prefs = readAll();
  prefs.participantVolumes = prefs.participantVolumes || {};
  prefs.participantVolumes[key] = volume;
  writeAll(prefs);
}
