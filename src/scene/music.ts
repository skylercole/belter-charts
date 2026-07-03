/**
 * Ride music. Two sources:
 *
 * 1. Procedural "burn anthem": an ORIGINAL hard-rock loop synthesized live —
 *    drums, distorted power-chord riff, bass, organ arpeggio. Deliberately
 *    not any existing song (no licensed audio ships with this app; see
 *    Plan.md §12). Intensity input (0..1, mapped from burn g) adds layers
 *    and opens the filter.
 *
 * 2. Bring-your-own-anthem: user drops an audio file; it is decoded and kept
 *    in IndexedDB locally (never uploaded) and replaces the procedural track.
 *
 * All scheduling uses the WebAudio clock with a 25 ms lookahead pump.
 */

const BPM = 132;
const BEAT = 60 / BPM;
const LOOKAHEAD_S = 0.12;
const PUMP_MS = 25;

// E minor rock progression, two bars per chord: Em / D / A5 / Em.
// Frequencies for E2, D2/D3, A2 roots.
const RIFF: { root: number; fifth: number }[] = [
  { root: 82.41, fifth: 123.47 }, // E2 + B2
  { root: 73.42, fifth: 110.0 }, // D2 + A2
  { root: 110.0, fifth: 164.81 }, // A2 + E3
  { root: 82.41, fifth: 123.47 },
];
// Organ arpeggio degrees over each chord (semitone offsets from root, +1 octave)
const ARP = [0, 7, 12, 7, 3, 7, 12, 15];

const DB_NAME = "flip-and-burn";
const DB_STORE = "anthem";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class RideMusic {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private drive: WaveShaperNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private pump: number | null = null;
  private nextNoteTime = 0;
  private step = 0; // 8th-note counter
  private intensity = 0.5;
  private muted = false;
  private playing = false;

  /** custom user track */
  private customBuf: AudioBuffer | null = null;
  private customSrc: AudioBufferSourceNode | null = null;

  private ensure() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;

    // gentle master saturation for glue
    this.drive = this.ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 128 - 1) * 1.4;
      curve[i] = Math.tanh(x);
    }
    this.drive.curve = curve;

    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 2500;

    this.master.connect(this.drive).connect(this.filter).connect(this.ctx.destination);
  }

  async unlock() {
    this.ensure();
    await this.ctx!.resume();
    if (!this.customBuf) this.loadCustomFromDb().catch(() => {});
  }

  /** Try to load a previously saved user track. */
  private async loadCustomFromDb() {
    const db = await openDb();
    const data = await new Promise<ArrayBuffer | undefined>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).get("track");
      req.onsuccess = () => resolve(req.result as ArrayBuffer | undefined);
      req.onerror = () => reject(req.error);
    });
    if (data && this.ctx) {
      this.customBuf = await this.ctx.decodeAudioData(data.slice(0));
    }
  }

  /** Set a user-supplied audio file as the anthem. Stored locally only. */
  async setCustomTrack(file: File): Promise<void> {
    this.ensure();
    const data = await file.arrayBuffer();
    this.customBuf = await this.ctx!.decodeAudioData(data.slice(0));
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(data, "track");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    if (this.playing) {
      this.stop();
      this.start(this.intensity);
    }
  }

  async clearCustomTrack(): Promise<void> {
    this.customBuf = null;
    const db = await openDb();
    db.transaction(DB_STORE, "readwrite").objectStore(DB_STORE).delete("track");
    if (this.playing) {
      this.stop();
      this.start(this.intensity);
    }
  }

  hasCustomTrack(): boolean {
    return !!this.customBuf;
  }

  start(intensity: number) {
    this.ensure();
    this.intensity = intensity;
    this.playing = true;
    const t = this.ctx!.currentTime;
    this.master!.gain.cancelScheduledValues(t);
    this.master!.gain.setTargetAtTime(this.muted ? 0 : 0.5, t, 0.5);

    if (this.customBuf) {
      this.customSrc = this.ctx!.createBufferSource();
      this.customSrc.buffer = this.customBuf;
      this.customSrc.loop = true;
      this.customSrc.connect(this.master!);
      this.customSrc.start();
      return;
    }
    this.nextNoteTime = t + 0.05;
    this.step = 0;
    this.pump = window.setInterval(() => this.schedule(), PUMP_MS);
  }

  stop() {
    this.playing = false;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    }
    if (this.pump !== null) {
      clearInterval(this.pump);
      this.pump = null;
    }
    if (this.customSrc) {
      const src = this.customSrc;
      this.customSrc = null;
      setTimeout(() => src.stop(), 800);
    }
  }

  setIntensity(x: number) {
    this.intensity = Math.min(Math.max(x, 0), 1);
    if (this.filter && this.ctx) {
      this.filter.frequency.setTargetAtTime(
        1200 + 6000 * this.intensity,
        this.ctx.currentTime,
        0.5
      );
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(
        m || !this.playing ? 0 : 0.5,
        this.ctx.currentTime,
        0.15
      );
    }
  }

  // ---- procedural sequencer ----

  private schedule() {
    if (!this.ctx || !this.playing || this.customBuf) return;
    while (this.nextNoteTime < this.ctx.currentTime + LOOKAHEAD_S) {
      this.playStep(this.step, this.nextNoteTime);
      this.nextNoteTime += BEAT / 2; // 8th notes
      this.step = (this.step + 1) % 64; // 8 bars of 8ths
    }
  }

  private playStep(step: number, t: number) {
    const eighthInBar = step % 8;
    const bar = Math.floor(step / 8);
    const chord = RIFF[Math.floor(bar / 2) % 4];

    // drums
    if (eighthInBar === 0 || eighthInBar === 4) this.kick(t);
    if (eighthInBar === 2 || eighthInBar === 6) this.snare(t);
    this.hat(t, eighthInBar % 2 === 1);
    if (this.intensity > 0.6 && (eighthInBar === 3 || eighthInBar === 7)) this.kick(t, 0.6);

    // bass: driving 8ths on the root
    this.bass(chord.root / 2, t);

    // power chords: hits on 1 and the & of 2, plus 4 at high intensity
    if (this.intensity > 0.25) {
      if (eighthInBar === 0 || eighthInBar === 3) this.powerChord(chord, t, 0.9);
      else if (this.intensity > 0.55 && eighthInBar === 6) this.powerChord(chord, t, 0.7);
    }

    // organ arpeggio on top at high burn
    if (this.intensity > 0.5) {
      const semi = ARP[eighthInBar];
      this.organ(chord.root * 2 * Math.pow(2, semi / 12), t);
    }
  }

  private kick(t: number, vel = 1) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  private snare(t: number) {
    const ctx = this.ctx!;
    const len = 0.18;
    const buf = ctx.createBuffer(1, len * ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(bp).connect(g).connect(this.master!);
    src.start(t);
  }

  private hat(t: number, off: boolean) {
    const ctx = this.ctx!;
    const len = 0.05;
    const buf = ctx.createBuffer(1, len * ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 8000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(off ? 0.12 : 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(hp).connect(g).connect(this.master!);
    src.start(t);
  }

  private bass(freq: number, t: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.32, t);
    g.gain.setTargetAtTime(0.12, t + 0.02, 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + BEAT / 2 - 0.02);
    osc.connect(lp).connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + BEAT / 2);
  }

  private powerChord(chord: { root: number; fifth: number }, t: number, vel: number) {
    const ctx = this.ctx!;
    // distorted twin saws root+fifth
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) curve[i] = Math.tanh((i / 128 - 1) * 6);
    shaper.curve = curve;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22 * vel, t);
    g.gain.setTargetAtTime(0.08 * vel, t + 0.05, 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    shaper.connect(g).connect(this.master!);
    for (const f of [chord.root * 2, chord.fifth * 2, chord.root * 2 * 1.005]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = 0.5;
      osc.connect(og).connect(shaper);
      osc.start(t);
      osc.stop(t + 0.55);
    }
  }

  private organ(freq: number, t: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + BEAT / 2);
    g.connect(this.master!);
    for (const mult of [1, 2, 3]) {
      const osc = ctx.createOscillator();
      osc.type = mult === 3 ? "sine" : "square";
      osc.frequency.value = freq * mult;
      const og = ctx.createGain();
      og.gain.value = mult === 1 ? 0.5 : mult === 2 ? 0.25 : 0.12;
      osc.connect(og).connect(g);
      osc.start(t);
      osc.stop(t + BEAT / 2 + 0.05);
    }
  }
}

/** Shared instance: the scene drives playback, the panel manages the track. */
export const rideMusic = new RideMusic();

/** Check IndexedDB for a saved track without creating an AudioContext. */
export async function hasSavedTrack(): Promise<boolean> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get("track");
      req.onsuccess = () => resolve(!!req.result);
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}
