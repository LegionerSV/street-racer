type FrameWork = {
  physics: number;
  traffic: number;
  visuals: number;
  render: number;
  install: number;
};
type RenderWork = Record<
  'activeMeshesEvaluation' | 'renderTargets' | 'mainPass',
  number | null
>;
export class RenderWorkTimings {
  private frames: RenderWork[] = [];
  private next = 0;
  constructor(private capacity = 600) {}
  add(frame: RenderWork) {
    this.frames[this.next] = { ...frame };
    this.next = (this.next + 1) % this.capacity;
  }
  reset() {
    this.frames = [];
    this.next = 0;
  }
  summary() {
    if (!this.frames.length) return null;
    const section = (key: keyof RenderWork) => {
      const values = this.frames
        .map((frame) => frame[key])
        .filter(
          (ms): ms is number => ms !== null && Number.isFinite(ms) && ms >= 0,
        )
        .sort((a, b) => a - b);
      return values.length
        ? {
            samples: values.length,
            meanMs: values.reduce((sum, ms) => sum + ms, 0) / values.length,
            p95Ms: values[Math.ceil(values.length * 0.95) - 1],
          }
        : null;
    };
    return {
      frames: this.frames.length,
      activeMeshesEvaluation: section('activeMeshesEvaluation'),
      renderTargets: section('renderTargets'),
      mainPass: section('mainPass'),
    };
  }
}

export class FrameWorkTimings {
  private frames: FrameWork[] = [];
  private next = 0;
  constructor(private capacity = 600) {}
  add(frame: FrameWork) {
    if (Object.values(frame).some((ms) => !Number.isFinite(ms) || ms < 0))
      return;
    this.frames[this.next] = frame;
    this.next = (this.next + 1) % this.capacity;
  }
  reset() {
    this.frames = [];
    this.next = 0;
  }
  summary() {
    if (!this.frames.length) return null;
    const section = (key: keyof FrameWork) => {
      const values = this.frames
        .map((frame) => frame[key])
        .sort((a, b) => a - b);
      return {
        meanMs: values.reduce((sum, ms) => sum + ms, 0) / values.length,
        p95Ms: values[Math.ceil(values.length * 0.95) - 1],
      };
    };
    return {
      samples: this.frames.length,
      physics: section('physics'),
      traffic: section('traffic'),
      visuals: section('visuals'),
      render: section('render'),
      install: section('install'),
    };
  }
}

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
