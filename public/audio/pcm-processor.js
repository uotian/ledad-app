// 入力を16kHzのモノラルPCMへ変換し、約100msごとに送ります。
class PcmProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.samples = []; this.position = 0; }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    const ratio = sampleRate / 16000;
    for (; this.position < input.length; this.position += ratio) {
      const value = Math.max(-1, Math.min(1, input[Math.floor(this.position)]));
      this.samples.push(value < 0 ? value * 32768 : value * 32767);
      if (this.samples.length === 1600) {
        const pcm = new Int16Array(this.samples);
        this.port.postMessage(pcm.buffer, [pcm.buffer]);
        this.samples = [];
      }
    }
    this.position -= input.length;
    return true;
  }
}
registerProcessor('pcm-processor', PcmProcessor);
