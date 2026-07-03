/**
 * WebAudio engine sound: filtered brown noise for the drive rumble, a soft
 * two-tone cue at flip. Fully synthesized — no audio assets, no licensing.
 * Context is created lazily on the first user gesture (the Engage click).
 */
export class EngineSound {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private muted = false;
  private thrust = 0;

  private ensure() {
    if (this.ctx) return;
    this.ctx = new AudioContext();

    // 4 s brown-noise loop
    const len = 4 * this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 110;
    lp.Q.value = 0.7;

    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;

    src.connect(lp).connect(this.gain).connect(this.ctx.destination);
    src.start();
  }

  /**
   * Create/resume the context. Must be called synchronously from a user
   * gesture (the store subscriber chain of the Engage click qualifies).
   */
  unlock() {
    this.ensure();
    this.ctx?.resume();
  }

  /** thrust 0..1; call every frame while riding. */
  setThrust(x: number) {
    if (!this.ctx && x === 0) return;
    this.ensure();
    if (!this.gain || !this.ctx) return;
    const target = this.muted ? 0 : 0.16 * x;
    if (Math.abs(target - this.thrust) > 1e-3) {
      this.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.25);
      this.thrust = target;
    }
  }

  /** Two-tone cue when the drive cuts for the flip. */
  flipCue() {
    this.ensure();
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    for (const [freq, at] of [
      [660, 0],
      [440, 0.18],
    ] as const) {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t + at);
      g.gain.linearRampToValueAtTime(0.07, t + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + at + 0.3);
      osc.connect(g).connect(this.ctx.destination);
      osc.start(t + at);
      osc.stop(t + at + 0.35);
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.gain && this.ctx) {
      this.gain.gain.setTargetAtTime(m ? 0 : this.thrust, this.ctx.currentTime, 0.1);
    }
  }

  stop() {
    this.setThrust(0);
  }
}
