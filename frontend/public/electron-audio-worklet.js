// AudioWorkletProcessor que recebe blocos PCM float32 intercalados (vindos
// da captura nativa de áudio por processo, no app desktop Electron) via
// port.postMessage e os reproduz na saída, permitindo transformá-los num
// MediaStreamTrack comum via AudioContext.createMediaStreamDestination().
class PcmBridgeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.readFrame = 0;
    this.port.onmessage = (event) => {
      const { samples, channels } = event.data;
      if (samples && channels) this.queue.push({ samples, channels });
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const outChannels = output.length;
    const frameCount = output[0]?.length || 0;

    for (let frame = 0; frame < frameCount; frame += 1) {
      const current = this.queue[0];

      if (!current) {
        for (let ch = 0; ch < outChannels; ch += 1) output[ch][frame] = 0;
        continue;
      }

      const frameOffset = this.readFrame * current.channels;
      for (let ch = 0; ch < outChannels; ch += 1) {
        const srcChannel = Math.min(ch, current.channels - 1);
        output[ch][frame] = current.samples[frameOffset + srcChannel] || 0;
      }

      this.readFrame += 1;
      if (this.readFrame >= current.samples.length / current.channels) {
        this.queue.shift();
        this.readFrame = 0;
      }
    }

    return true;
  }
}

registerProcessor("pcm-bridge-processor", PcmBridgeProcessor);
