// AudioWorklet: mixes the input to mono and posts fixed-size Float32 chunks (100 ms at 16 kHz).
class PcmTap extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.size = options.processorOptions.chunk
    this.buffer = new Float32Array(this.size)
    this.filled = 0
  }

  process(inputs) {
    const channels = inputs[0]
    if (channels === undefined || channels.length === 0) return true
    const frames = channels[0].length
    for (let i = 0; i < frames; i++) {
      let sum = 0
      for (let c = 0; c < channels.length; c++) sum += channels[c][i]
      this.buffer[this.filled++] = sum / channels.length
      if (this.filled === this.size) {
        this.port.postMessage(this.buffer.slice())
        this.filled = 0
      }
    }
    return true
  }
}

registerProcessor('pcm-tap', PcmTap)
