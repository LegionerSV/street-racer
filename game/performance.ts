export class FrameTimings {
  private samples: number[] = [];
  private next = 0;
  streamingFrames = 0;
  constructor(private capacity = 600) {}
  add(ms: number, streaming = false) {
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.samples[this.next] = ms;
    this.next = (this.next + 1) % this.capacity;
    if (streaming) this.streamingFrames++;
  }
  reset() {
    this.samples = [];
    this.next = 0;
    this.streamingFrames = 0;
  }
  summary() {
    const sorted = [...this.samples].sort((a, b) => a - b),
      count = sorted.length,
      total = sorted.reduce((a, b) => a + b, 0);
    return {
      samples: count,
      p95FrameMs: count ? sorted[Math.ceil(count * 0.95) - 1] : null,
      meanFrameMs: count ? total / count : null,
      overBudgetPercent: count
        ? (sorted.filter((ms) => ms > 1000 / 30).length / count) * 100
        : null,
      streamingFrames: this.streamingFrames,
    };
  }
}
