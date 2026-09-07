export class EngineSound {
  private context: AudioContext | null = null;
  private oscillators: OscillatorNode[] = [];
  private gain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  start() {
    try {
      this.context = new AudioContext(); this.gain = this.context.createGain(); this.gain.gain.value = 0;
      this.filter = this.context.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 450;
      this.filter.connect(this.gain); this.gain.connect(this.context.destination);
      for (const detune of [-8, 0, 9]) { const oscillator = this.context.createOscillator(); oscillator.type = 'sawtooth'; oscillator.frequency.value = 40; oscillator.detune.value = detune; oscillator.connect(this.filter); oscillator.start(); this.oscillators.push(oscillator); }
      void this.context.resume();
    } catch { this.context = null; }
  }
  resume(){if(this.context?.state==='suspended')void this.context.resume().catch(()=>{});}
  update(speed: number, throttle: boolean, volume: number, paused: boolean) {
    if (!this.context || !this.gain || !this.filter) return;
    const t = this.context.currentTime, gear = Math.max(1, Math.min(6, Math.floor(Math.abs(speed) / 10) + 1));
    const rpm = 33 + Math.abs(speed) / gear * 7 + (throttle ? 15 : 0);
    this.oscillators.forEach((o, i) => o.frequency.setTargetAtTime(rpm * (i === 2 ? .5 : 1), t, .1));
    this.filter.frequency.setTargetAtTime(250 + rpm * 3, t, .12);
    this.gain.gain.setTargetAtTime(paused ? 0 : volume * .028 * (throttle ? 1 : .5), t, .1);
  }
  dispose() { this.oscillators.forEach(o => o.stop()); void this.context?.close(); this.context = null; }
}
