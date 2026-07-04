/**
 * Ride soundtrack. Four original tracks ship with the app (project-owned,
 * Highway-Star-spirited; see CREDITS.md):
 *
 *   short (~60 s):  Neon Overdrive 1 & 2   — quick hops
 *   long  (~250 s): Chrome Overdrive 1 & 2 — long hauls
 *
 * Selection is by ride wall-clock length: rides that play out in under a
 * minute get a short track, longer cinematic rides get an epic. Within a
 * class the two tracks alternate between rides.
 *
 * Mixing chain: source -> track gain -> flip filter (lowpass ducks the music
 * while the drive is off at flip) -> compressor -> master gain -> out.
 * Tracks decode lazily on first use and stay cached for repeat rides.
 */

interface TrackDef {
  url: string;
  kind: "short" | "long";
}

const TRACKS: TrackDef[] = [
  { url: "music/neon-overdrive-1.mp3", kind: "short" },
  { url: "music/neon-overdrive-2.mp3", kind: "short" },
  { url: "music/chrome-overdrive-1.mp3", kind: "long" },
  { url: "music/chrome-overdrive-2.mp3", kind: "long" },
];

/** rides shorter than this (wall seconds) get a short track */
const SHORT_RIDE_S = 65;

export class RideMusic {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private flipFilter: BiquadFilterNode | null = null;
  private trackGain: GainNode | null = null;
  private src: AudioBufferSourceNode | null = null;
  private cache = new Map<string, AudioBuffer>();
  private nextIdx: Record<"short" | "long", number> = { short: 0, long: 0 };
  private muted = false;
  private playing = false;
  private startSeq = 0;

  constructor(private baseUrl: string = "") {}

  setBaseUrl(base: string) {
    this.baseUrl = base;
  }

  private ensure() {
    if (this.ctx) return;
    this.ctx = new AudioContext();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;

    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.01;
    this.compressor.release.value = 0.2;

    this.flipFilter = this.ctx.createBiquadFilter();
    this.flipFilter.type = "lowpass";
    this.flipFilter.frequency.value = 18_000;
    this.flipFilter.Q.value = 0.5;

    this.trackGain = this.ctx.createGain();
    this.trackGain.gain.value = 0;

    this.trackGain
      .connect(this.flipFilter)
      .connect(this.compressor)
      .connect(this.master)
      .connect(this.ctx.destination);
  }

  /** Call synchronously from a user gesture so the context may resume. */
  unlock() {
    this.ensure();
    this.ctx!.resume();
  }

  private async load(url: string): Promise<AudioBuffer> {
    const cached = this.cache.get(url);
    if (cached) return cached;
    const res = await fetch(this.baseUrl + url);
    if (!res.ok) throw new Error(`music fetch failed: ${url}`);
    const buf = await this.ctx!.decodeAudioData(await res.arrayBuffer());
    this.cache.set(url, buf);
    return buf;
  }

  /** Pick a track class by how long the ride will actually play (wall s). */
  private pick(rideWallSec: number): TrackDef {
    const kind = rideWallSec < SHORT_RIDE_S ? "short" : "long";
    const pool = TRACKS.filter((t) => t.kind === kind);
    const track = pool[this.nextIdx[kind] % pool.length];
    this.nextIdx[kind]++;
    return track;
  }

  /** Start the soundtrack for a ride expected to last rideWallSec. */
  async start(rideWallSec: number) {
    this.ensure();
    this.playing = true;
    const seq = ++this.startSeq;
    const track = this.pick(rideWallSec);

    let buf: AudioBuffer;
    try {
      buf = await this.load(track.url);
    } catch (e) {
      console.warn(e);
      return;
    }
    // ride ended (or another started) while decoding
    if (!this.playing || seq !== this.startSeq || !this.ctx) return;

    this.src = this.ctx.createBufferSource();
    this.src.buffer = buf;
    this.src.loop = true; // safety net if a ride outlasts the track
    this.src.connect(this.trackGain!);
    const t = this.ctx.currentTime;
    this.trackGain!.gain.cancelScheduledValues(t);
    this.trackGain!.gain.setValueAtTime(0, t);
    this.trackGain!.gain.linearRampToValueAtTime(0.85, t + 1.2);
    this.src.start();
  }

  stop() {
    this.playing = false;
    this.startSeq++;
    if (this.ctx && this.trackGain) {
      const t = this.ctx.currentTime;
      this.trackGain.gain.cancelScheduledValues(t);
      this.trackGain.gain.setValueAtTime(this.trackGain.gain.value, t);
      this.trackGain.gain.linearRampToValueAtTime(0, t + 1.4);
    }
    if (this.src) {
      const src = this.src;
      this.src = null;
      setTimeout(() => {
        try {
          src.stop();
        } catch {
          /* already stopped */
        }
      }, 1600);
    }
  }

  /** Drive-off moment: pull the music underwater while flipping. */
  setFlip(flipping: boolean) {
    if (!this.ctx || !this.flipFilter) return;
    this.flipFilter.frequency.setTargetAtTime(
      flipping ? 380 : 18_000,
      this.ctx.currentTime,
      flipping ? 0.15 : 0.4
    );
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.15);
    }
  }

  isPlaying(): boolean {
    return this.playing;
  }
}

/** Shared instance: the scene drives playback. */
export const rideMusic = new RideMusic();
