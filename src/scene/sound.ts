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

  /** Repeating brace-for-flip klaxon: three urgent pairs. */
  braceKlaxon() {
    this.ensure();
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      for (const [f, at] of [
        [520, 0],
        [390, 0.14],
      ] as const) {
        const t = t0 + i * 0.5 + at;
        const osc = this.ctx.createOscillator();
        osc.type = "square";
        osc.frequency.value = f;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.045, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        osc.connect(g).connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + 0.14);
      }
    }
  }

  /** Racing heartbeat, slowing to steady — the juice hitting. */
  heartbeat() {
    this.ensure();
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    let at = 0;
    // interval widens: 0.32 s -> 0.7 s over ~8 beats
    for (let i = 0; i < 8; i++) {
      for (const [gain, off] of [
        [0.28, 0],
        [0.18, 0.12],
      ] as const) {
        const t = t0 + at + off;
        const osc = this.ctx.createOscillator();
        osc.frequency.setValueAtTime(70, t);
        osc.frequency.exponentialRampToValueAtTime(38, t + 0.08);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
        osc.connect(g).connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + 0.16);
      }
      at += 0.32 + (0.38 * i) / 7;
    }
  }

  /** Hull creaks during zero-g: a few low filtered-noise groans. */
  creaks() {
    this.ensure();
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const t = t0 + 0.3 + i * (0.7 + Math.random() * 0.5);
      const len = 0.4;
      const buf = this.ctx.createBuffer(1, len * this.ctx.sampleRate, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = 0.35;
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 140 + Math.random() * 120;
      bp.Q.value = 9;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.14, t + 0.12);
      g.gain.exponentialRampToValueAtTime(0.001, t + len * 2.2);
      src.connect(bp).connect(g).connect(this.ctx.destination);
      src.start(t);
    }
  }

  /** Docking clamps: deep double thunk. */
  dockThunk() {
    this.ensure();
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    for (const at of [0, 0.28]) {
      const t = t0 + at;
      const osc = this.ctx.createOscillator();
      osc.frequency.setValueAtTime(90, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.1);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.4, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(g).connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.4);
      // metallic click layer
      const len = 0.04;
      const buf = this.ctx.createBuffer(1, len * this.ctx.sampleRate, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const hp = this.ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 2500;
      const cg = this.ctx.createGain();
      cg.gain.setValueAtTime(0.12, t);
      cg.gain.exponentialRampToValueAtTime(0.001, t + len * 2);
      src.connect(hp).connect(cg).connect(this.ctx.destination);
      src.start(t);
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
