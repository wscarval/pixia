// Detecta quem está falando a partir do nível de volume de cada stream de
// áudio (não é reconhecimento de voz de verdade, só volume acima de um
// limiar), o suficiente pra acender um indicador visual tipo "está falando".

// 0-255 (média de frequência do AnalyserNode). Ajustado por teste manual;
// se estiver disparando com ruído de fundo ou não pegando fala baixa, mexer
// aqui é o primeiro lugar a olhar.
const SPEAKING_THRESHOLD = 14;

// Continua "falando" por um tempo depois do volume cair, sem isso uma
// pausa natural entre palavras já apaga o indicador e fica piscando.
const HOLD_MS = 450;

// Observa o volume de uma MediaStream e chama onChange(true/false) só
// quando o estado de "falando" muda de verdade (não a cada frame). Retorna
// uma função de limpeza que desliga tudo (AudioContext incluso).
export function watchSpeakingLevel(stream, onChange) {
  const audioTrack = stream?.getAudioTracks?.()[0];
  if (!audioTrack) return () => {};

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return () => {};

  let audioContext;
  let analyser;
  let source;

  try {
    audioContext = new AudioContextClass();
    source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
  } catch {
    // Stream sem áudio de verdade ainda, ou AudioContext bloqueado. Sem
    // indicador de fala pra essa stream, sem quebrar o resto do app.
    return () => {};
  }

  const data = new Uint8Array(analyser.frequencyBinCount);
  let speaking = false;
  let lastLoudAt = 0;
  let rafId = null;
  let stopped = false;

  function tick() {
    if (stopped) return;

    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) sum += data[i];
    const average = sum / data.length;

    const now = performance.now();
    if (average > SPEAKING_THRESHOLD) lastLoudAt = now;

    const nextSpeaking = now - lastLoudAt < HOLD_MS;
    if (nextSpeaking !== speaking) {
      speaking = nextSpeaking;
      onChange(speaking);
    }

    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    if (rafId) cancelAnimationFrame(rafId);
    try {
      source.disconnect();
      analyser.disconnect();
    } catch {
      // já desconectado
    }
    audioContext.close().catch(() => {});
  };
}
