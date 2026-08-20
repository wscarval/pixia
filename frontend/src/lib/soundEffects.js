// Efeitos sonoros de eventos da sala (entrar, sair, começar/parar de
// compartilhar tela). Tocam pra quem já está na sala quando outra pessoa faz
// a ação — nunca pra quem fez a ação (o servidor já não manda esses eventos
// de volta pra quem os disparou, então isso já vem de graça).

const SOUND_URLS = {
  enterRoom: "/effects/enter_room.mp3",
  leftRoom: "/effects/left_room.mp3",
  screenShare: "/effects/screen_share.mp3",
  stopScreenShare: "/effects/stop_screen_share.mp3",
};

const VOLUME = 0.5;

export function playSoundEffect(key) {
  const url = SOUND_URLS[key];
  if (!url) return;

  try {
    const audio = new Audio(url);
    audio.volume = VOLUME;
    // Autoplay pode ser bloqueado antes de qualquer interação do usuário na
    // página — não deveria acontecer aqui (entrar numa sala já exige clique
    // num botão antes), mas ignora silenciosamente se acontecer mesmo assim.
    audio.play().catch(() => {});
  } catch {
    // ignore
  }
}
