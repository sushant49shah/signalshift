class SegmentRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.target = options.processorOptions.frames;
    this.samples = new Float32Array(this.target);
    this.offset = 0;
    this.stopRequested = false;
    this.port.onmessage = (event) => {
      if (event.data === "stop") this.stopRequested = true;
    };
  }
  process(inputs) {
    if (this.stopRequested && this.offset > 0) {
      this.flush();
      return false;
    }
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
      this.flush();
      return false;
    }
    return true;
  }
  flush() {
    const samples = this.samples.slice(0, this.offset);
    this.port.postMessage(samples.buffer, [samples.buffer]);
  }
}
registerProcessor("segment-recorder", SegmentRecorder);
