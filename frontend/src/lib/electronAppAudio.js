// Ponte entre a captura nativa de áudio por processo (exposta pelo app
// desktop Electron via window.workroomDesktop) e um MediaStreamTrack comum,
// utilizável como qualquer outra fonte de áudio do WebRTC. Só funciona
// dentro do app desktop — no navegador comum, isElectronDesktop() é falso e
// as demais funções não devem ser chamadas.

export function isElectronDesktop() {
  return typeof window !== "undefined" && Boolean(window.workroomDesktop?.isDesktop);
}

export async function listAppAudioSources() {
  if (!isElectronDesktop()) return [];

  try {
    const sessions = await window.workroomDesktop.listAudioSessions();
    return Array.isArray(sessions) ? sessions : [];
  } catch {
    return [];
  }
}

let activeSession = null;

export async function startAppAudioCapture(pid) {
  if (!isElectronDesktop()) {
    throw new Error("Captura de áudio por app só está disponível no aplicativo desktop.");
  }

  await stopAppAudioCapture();

  const { format } = await window.workroomDesktop.startProcessAudioCapture(pid);
  if (!format) {
    throw new Error("Não foi possível determinar o formato do áudio capturado.");
  }

  const audioContext = new AudioContext({ sampleRate: format.sampleRate });
  await audioContext.audioWorklet.addModule("/electron-audio-worklet.js");

  const workletNode = new AudioWorkletNode(audioContext, "pcm-bridge-processor", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [format.channels],
  });

  const destination = audioContext.createMediaStreamDestination();
  workletNode.connect(destination);

  const bytesPerSample = format.bitsPerSample / 8;

  const removeListener = window.workroomDesktop.onAudioChunk((chunk) => {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    let samples;

    if (format.isFloat && bytesPerSample === 4) {
      samples = new Float32Array(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      );
    } else if (!format.isFloat && bytesPerSample === 2) {
      const int16 = new Int16Array(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      );
      samples = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i += 1) samples[i] = int16[i] / 32768;
    } else {
      return;
    }

    workletNode.port.postMessage({ samples, channels: format.channels }, [samples.buffer]);
  });

  activeSession = { audioContext, workletNode, removeListener };

  // Não há listener de "ended" automático aqui de propósito: ao trocar de
  // uma fonte de app para outra, a faixa antiga é parada (ver
  // useRoomWebRTC.js) DEPOIS que a nova captura já está ativa — um listener
  // aqui chamaria stopAppAudioCapture() sobre a sessão nova por engano. A
  // parada é sempre explícita, feita por quem chama esta função.
  return destination.stream.getAudioTracks()[0];
}

export async function stopAppAudioCapture() {
  if (!activeSession) return;

  const { audioContext, workletNode, removeListener } = activeSession;
  activeSession = null;

  removeListener?.();

  try {
    await window.workroomDesktop.stopProcessAudioCapture();
  } catch {
    // ignore
  }

  workletNode.disconnect();
  await audioContext.close().catch(() => {});
}
