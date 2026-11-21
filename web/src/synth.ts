// Preview Web Audio estilo 303: saw → lowpass resonante → VCA.
// Scheduler con look-ahead ("A Tale of Two Clocks"): el timer solo agenda; el reloj es AudioContext.

import { semitone, type Pattern, type Step } from "./domain";

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.1;

export function stepDuration(bpm: number, triplet: boolean): number {
  return 60 / bpm / (triplet ? 3 : 4);
}

export function midiOf(step: Step): number {
  return 36 + 12 * step.octave + semitone(step.note); // C2 = octava 0
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export class AcidSynth {
  private ctx: AudioContext | null = null;
  private osc!: OscillatorNode;
  private filter!: BiquadFilterNode;
  private vca!: GainNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private index = 0;
  private slideFromPrev = false;

  pattern: Pattern | null = null;
  bpm = 128;
  cutoff = 500;
  resonance = 12;
  onStep: (i: number) => void = () => {};

  private ensure(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext();
    this.osc = ctx.createOscillator();
    this.osc.type = "sawtooth";
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.vca = ctx.createGain();
    this.vca.gain.value = 0;
    const out = ctx.createGain();
    out.gain.value = 0.35;
    this.osc.connect(this.filter).connect(this.vca).connect(out).connect(ctx.destination);
    this.osc.start();
    this.ctx = ctx;
    return ctx;
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  /** Debe llamarse desde un gesto del usuario (Android bloquea el audio hasta un tap). */
  async start(): Promise<void> {
    const ctx = this.ensure();
    await ctx.resume();
    this.stop();
    this.index = 0;
    this.slideFromPrev = false;
    this.nextTime = ctx.currentTime + 0.05;
    this.timer = setInterval(() => this.tick(), LOOKAHEAD_MS);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.ctx) {
      const t = this.ctx.currentTime;
      this.vca.gain.cancelScheduledValues(t);
      this.vca.gain.setTargetAtTime(0, t, 0.01);
    }
    this.onStep(-1);
  }

  private tick(): void {
    const ctx = this.ctx;
    const p = this.pattern;
    if (!ctx || !p) return;
    while (this.nextTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
      const dur = stepDuration(this.bpm, p.triplet);
      const i = this.index % p.length;
      this.schedule(p, i, this.nextTime, dur);
      const at = this.nextTime;
      setTimeout(() => this.onStep(i), Math.max(0, (at - ctx.currentTime) * 1000));
      this.nextTime += dur;
      this.index = (i + 1) % p.length;
    }
  }

  private schedule(p: Pattern, i: number, t: number, dur: number): void {
    const step = p.steps[i]!;
    const next = p.steps[(i + 1) % p.length]!;
    const g = this.vca.gain;
    const f = this.filter.frequency;
    this.filter.Q.setValueAtTime(this.resonance, t);

    if (step.gate === "off") {
      g.setTargetAtTime(0, t, 0.005);
      this.slideFromPrev = false;
      return;
    }
    if (step.gate === "on") {
      const freq = hz(midiOf(step));
      if (this.slideFromPrev) {
        // Slide 303: sin reataque, glide de ~60 ms hacia la nota nueva.
        this.osc.frequency.setTargetAtTime(freq, t, 0.02);
      } else {
        this.osc.frequency.setValueAtTime(freq, t);
        const peak = step.accent ? 0.9 : 0.55;
        const envTop = this.cutoff * (step.accent ? 6 : 3.5);
        g.cancelScheduledValues(t);
        g.setValueAtTime(0, t);
        g.linearRampToValueAtTime(peak, t + 0.004);
        f.cancelScheduledValues(t);
        f.setValueAtTime(envTop, t);
        f.setTargetAtTime(this.cutoff, t + 0.005, step.accent ? 0.06 : 0.12);
      }
      this.slideFromPrev = step.slide && next.gate !== "off";
    }
    // `tie` y slide sostienen el gate; si no, se cierra a mitad del paso.
    const held = next.gate === "tie" || (this.slideFromPrev && next.gate === "on");
    if (!held) g.setTargetAtTime(0, t + dur * 0.55, 0.01);
  }
}
