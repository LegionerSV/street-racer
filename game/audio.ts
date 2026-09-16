const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

export type EngineAudioInput = {
  speed: number;
  throttle: boolean;
  slip: number;
  offRoad: boolean;
  wetness: number;
};

export function engineAudioState(input: EngineAudioInput) {
  const speed = Math.abs(input.speed),
    gear = Math.max(1, Math.min(6, Math.floor(speed / 10) + 1)),
    rpm = 33 + (speed / gear) * 7 + (input.throttle ? 15 : 0),
    tyreActivity =
      Math.abs(input.slip) * 0.2 +
      (input.offRoad ? clamp(speed / 45, 0, 1) * 0.16 : 0) +
      input.wetness * clamp(speed / 60, 0, 1) * 0.05;
  return {
    rpm,
    engineGain: input.throttle ? 1 : 0.5,
    engineFrequency: 250 + rpm * 3,
    windGain: clamp((speed - 8) / 180, 0, 0.2),
    windFrequency: 450 + speed * 24,
    tyreGain: clamp(tyreActivity, 0, 0.28),
    tyreFrequency: 700 + speed * 32 + Math.abs(input.slip) * 900,
  };
}

export class EngineSound {
  private context: AudioContext | null = null;
  private oscillators: OscillatorNode[] = [];
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private tyreGain: GainNode | null = null;
  private tyreFilter: BiquadFilterNode | null = null;
  private noise: AudioBufferSourceNode | null = null;
  private lastImpact = 0;

  start() {
    try {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.engineGain = this.context.createGain();
      this.engineFilter = this.context.createBiquadFilter();
      this.windGain = this.context.createGain();
      this.windFilter = this.context.createBiquadFilter();
      this.tyreGain = this.context.createGain();
      this.tyreFilter = this.context.createBiquadFilter();
      this.master.gain.value = 0;
      this.engineGain.gain.value = 0;
      this.windGain.gain.value = 0;
      this.tyreGain.gain.value = 0;
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 450;
      this.windFilter.type = 'bandpass';
      this.windFilter.Q.value = 0.35;
      this.tyreFilter.type = 'bandpass';
      this.tyreFilter.Q.value = 0.8;
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.windFilter.connect(this.windGain);
      this.windGain.connect(this.master);
      this.tyreFilter.connect(this.tyreGain);
      this.tyreGain.connect(this.master);
      this.master.connect(this.context.destination);
      for (const detune of [-8, 0, 9]) {
        const oscillator = this.context.createOscillator();
        oscillator.type = 'sawtooth';
        oscillator.frequency.value = 40;
        oscillator.detune.value = detune;
        oscillator.connect(this.engineFilter);
        oscillator.start();
        this.oscillators.push(oscillator);
      }
      const noiseBuffer = this.context.createBuffer(
        1,
        this.context.sampleRate * 2,
        this.context.sampleRate,
      );
      const samples = noiseBuffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++)
        samples[i] = Math.random() * 2 - 1;
      this.noise = this.context.createBufferSource();
      this.noise.buffer = noiseBuffer;
      this.noise.loop = true;
      this.noise.connect(this.windFilter);
      this.noise.connect(this.tyreFilter);
      this.noise.start();
      void this.context.resume();
    } catch {
      this.context = null;
    }
  }

  resume() {
    if (this.context?.state === 'suspended')
      void this.context.resume().catch(() => {});
  }

  update(
    input: EngineAudioInput & {
      volume: number;
      paused: boolean;
      impact?: number;
    },
  ) {
    if (
      !this.context ||
      !this.master ||
      !this.engineGain ||
      !this.engineFilter ||
      !this.windGain ||
      !this.windFilter ||
      !this.tyreGain ||
      !this.tyreFilter
    )
      return;
    const state = engineAudioState(input),
      time = this.context.currentTime;
    this.oscillators.forEach((oscillator, index) =>
      oscillator.frequency.setTargetAtTime(
        state.rpm * (index === 2 ? 0.5 : 1),
        time,
        0.1,
      ),
    );
    this.engineFilter.frequency.setTargetAtTime(
      state.engineFrequency,
      time,
      0.12,
    );
    this.engineGain.gain.setTargetAtTime(state.engineGain, time, 0.1);
    this.windFilter.frequency.setTargetAtTime(state.windFrequency, time, 0.2);
    this.windGain.gain.setTargetAtTime(state.windGain, time, 0.2);
    this.tyreFilter.frequency.setTargetAtTime(state.tyreFrequency, time, 0.08);
    this.tyreGain.gain.setTargetAtTime(state.tyreGain, time, 0.08);
    this.master.gain.setTargetAtTime(
      input.paused ? 0 : input.volume * 0.028,
      time,
      0.1,
    );
    if ((input.impact ?? 0) > 0.45 && this.lastImpact <= 0.45)
      this.playImpact(input.impact ?? 0.5);
    this.lastImpact = input.impact ?? 0;
  }

  private playImpact(intensity: number) {
    if (!this.context || !this.master) return;
    const time = this.context.currentTime,
      oscillator = this.context.createOscillator(),
      gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(95, time);
    oscillator.frequency.exponentialRampToValueAtTime(38, time + 0.18);
    gain.gain.setValueAtTime(clamp(intensity, 0.08, 0.5), time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.2);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(time);
    oscillator.stop(time + 0.21);
  }

  dispose() {
    this.oscillators.forEach((oscillator) => oscillator.stop());
    this.noise?.stop();
    void this.context?.close();
    this.context = null;
  }
}
