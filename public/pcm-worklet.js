class SegmentRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.target = options.processorOptions.frames;
    this.samples = new Float32Array(this.target);
    this.offset = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    const count = Math.min(channels[0].length, this.target - this.offset);
    for (let i = 0; i < count; i++) {
      let value = 0;
      for (const c of channels) value += c[i];
      this.samples[this.offset + i] = value / channels.length;
    }
    this.offset += count;
    if (this.offset >= this.target) {
      this.port.postMessage(this.samples.buffer, [this.samples.buffer]);
      return false;
    }
    return true;
  }
}
registerProcessor("segment-recorder", SegmentRecorder);
