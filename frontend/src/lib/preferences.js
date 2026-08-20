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

export function getPreferredScreenQuality() {
  const value = readAll().screenQuality;
  return value === "720p" ? "720p" : "1080p";
}

export function setPreferredScreenQuality(quality) {
  const prefs = readAll();
  prefs.screenQuality = quality === "720p" ? "720p" : "1080p";
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
