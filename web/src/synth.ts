// Preview Web Audio estilo 303: saw → lowpass resonante → VCA.
// Scheduler con look-ahead ("A Tale of Two Clocks"): el timer solo agenda; el reloj es AudioContext.

import { semitone, type Pattern, type Step } from "./domain";

import { DEFAULT_TONE, type Tone } from "./project";

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.1;

export function stepDuration(bpm: number, triplet: boolean): number {
  return 60 / bpm / (triplet ? 3 : 4);
}

export function midiOf(step: Step): number {
  return 36 + 12 * step.octave + semitone(step.note); // C2 = octava 0
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export function noteEnvelope(tone: Tone, accented: boolean) {
  return {
    peak: accented ? 0.55 + 0.35 * (tone.accent / 50) : 0.55,
    excursion: tone.cutoff * (accented ? 5 : 2.5) * (tone.envelope / 50),
    decay: (accented ? 0.06 : 0.12) * 4 ** ((tone.decay - 50) / 50),
  };
}

/** 70 % ≈ ganancia unitaria, el nivel que tenía la app antes de la perilla Volume. */
export const volumeGain = (volume: number) => 1.4 * volume / 100;

const saturation = (x: number) => Math.tanh(4 * x) * 0.25;
const driveGain = (amount: number) => 0.25 + 1.75 * amount / 100;
const driveCompensation = (gain: number) => gain ** -0.75;
const waveshaperCurve = (transform: (x: number) => number) =>
  Float32Array.from({ length: 2049 }, (_, i) => transform((i - 1024) / 1024));
export function driveCurve(): Float32Array<ArrayBuffer> {
  return waveshaperCurve(saturation);
}

export function driveLevels(amount: number) {
  const gain = driveGain(amount);
  return { input: gain, output: driveCompensation(gain) };
}

export class AcidSynth {
  private ctx: AudioContext | null = null;
  private osc!: OscillatorNode;
  private filter!: BiquadFilterNode;
  private vca!: GainNode;
  private filterEnv!: ConstantSourceNode;
  private filterDepth!: GainNode;
  private accentEnv!: ConstantSourceNode;
  private accentDepth!: GainNode;
  private master!: GainNode;
  private analyser?: AnalyserNode;
  private drumNoise?: AudioBuffer;
  private drumSources = new Set<AudioScheduledSourceNode>();
  private volume = 70;
  private dry!: GainNode;
  private wet!: GainNode;
  private driveInput!: GainNode;
  private driveLevel!: GainNode;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stepTimers = new Set<ReturnType<typeof setTimeout>>();
  private nextTime = 0;
  private index = 0;
  private slideFromPrev = false;
  private tone: Tone = DEFAULT_TONE;
  private startToken = 0;

  pattern: Pattern | null = null;
  bpm = 128;
  rhythm = { kick: false, hats: false };
  onStep: (i: number) => void = () => {};

  setTone(tone: Tone): void {
    const old = this.tone;
    this.tone = tone;
    if (this.ctx && tone !== old) this.applyTone(old);
  }

  private applyTone(previous?: Tone): void {
    const now = this.ctx!.currentTime;
    const set = (param: AudioParam, value: number, oldValue?: number) => {
      if (!previous) param.value = value;
      else if (value !== oldValue) param.setTargetAtTime(value, now, 0.015);
    };
    set(this.filter.frequency, this.tone.cutoff, previous?.cutoff);
    set(this.filter.Q, this.tone.resonance, previous?.resonance);
    const depth = (tone: Tone) => noteEnvelope(tone, false).excursion;
    const accent = (tone: Tone) => noteEnvelope(tone, true).peak - noteEnvelope(tone, false).peak;
    set(this.filterDepth.gain, depth(this.tone), previous && depth(previous));
    set(this.accentDepth.gain, accent(this.tone), previous && accent(previous));
    const levels = driveLevels(this.tone.drive);
    const oldLevels = previous && driveLevels(previous.drive);
    const mix = (tone: Tone) => tone.driveEnabled && tone.drive > 0 ? 1 : 0;
    set(this.driveInput.gain, levels.input, oldLevels?.input);
    set(this.driveLevel.gain, levels.output, oldLevels?.output);
    set(this.dry.gain, 1 - mix(this.tone), previous && 1 - mix(previous));
    set(this.wet.gain, mix(this.tone), previous && mix(previous));
  }

  private ensure(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext();
    this.osc = ctx.createOscillator();
    this.osc.type = "sawtooth";
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.vca = ctx.createGain();
    this.vca.gain.value = 0;

    this.filterEnv = ctx.createConstantSource();
    this.filterEnv.offset.value = 0;
    this.filterDepth = ctx.createGain();
    this.filterEnv.connect(this.filterDepth).connect(this.filter.frequency);
    this.filterEnv.start();

    this.accentEnv = ctx.createConstantSource();
    this.accentEnv.offset.value = 0;
    this.accentDepth = ctx.createGain();
    this.accentEnv.connect(this.accentDepth).connect(this.vca.gain);
    this.accentEnv.start();

    const out = ctx.createGain();
    out.gain.value = 0.35;
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.driveInput = ctx.createGain();
    this.driveLevel = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    shaper.curve = driveCurve();
    shaper.oversample = "2x";
    this.osc.connect(this.filter).connect(this.vca).connect(out);
    this.master = ctx.createGain();
    this.master.gain.value = volumeGain(this.volume);
    out.connect(this.dry).connect(this.master);
    out.connect(this.driveInput).connect(shaper).connect(this.driveLevel).connect(this.wet).connect(this.master);
    this.master.connect(ctx.destination);
    this.ctx = ctx;
    this.applyTone();
    this.osc.start();
    return ctx;
  }

  get scope(): AnalyserNode | undefined {
    if (!this.ctx) return;
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.master.connect(this.analyser);
    }
    return this.analyser;
  }

  private scheduleDrum(ctx: AudioContext, kind: "kick" | "hats", at: number): void {
    const envelope = ctx.createGain();
    envelope.connect(this.master);
    const end = at + (kind === "kick" ? 0.34 : 0.07);
    let source: AudioScheduledSourceNode;
    if (kind === "kick") {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(150, at);
      osc.frequency.exponentialRampToValueAtTime(42, at + 0.12);
      envelope.gain.setValueAtTime(0.001, at);
      envelope.gain.exponentialRampToValueAtTime(0.48, at + 0.003);
      osc.connect(envelope);
      source = osc;
    } else {
      if (!this.drumNoise) {
        this.drumNoise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.08), ctx.sampleRate);
        const data = this.drumNoise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = this.drumNoise;
      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = 7200;
      noise.connect(filter).connect(envelope);
      envelope.gain.setValueAtTime(0.16, at);
      source = noise;
    }
    envelope.gain.exponentialRampToValueAtTime(0.001, end);
    source.onended = () => {
      this.drumSources.delete(source);
      source.disconnect();
      envelope.disconnect();
    };
    this.drumSources.add(source);
    source.start(at);
    source.stop(end + 0.004);
  }

  /** Volumen de escucha 0–100 (preferencia local, no forma parte del proyecto). */
  setVolume(volume: number): void {
    this.volume = volume;
    if (this.ctx) this.master.gain.setTargetAtTime(volumeGain(volume), this.ctx.currentTime, 0.015);
  }

  /** Hace sonar un paso suelto mientras se edita, solo con el secuenciador detenido. */
  preview(step: Step): void {
    if (this.playing || step.gate === "off") return;
    const ctx = this.ensure();
    void ctx.resume();
    const note = { ...step, gate: "on" as const, slide: false };
    this.slideFromPrev = false;
    this.schedule({ steps: [note, { ...note, gate: "off" }], length: 2, triplet: false }, 0, ctx.currentTime + 0.01, 0.16);
    this.slideFromPrev = false;
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  /** Debe llamarse desde un gesto del usuario (Android bloquea el audio hasta un tap). */
  async start(): Promise<void> {
    this.stop();
    const token = this.startToken;
    const ctx = this.ensure();
    await ctx.resume();
    if (this.startToken !== token) return;
    this.index = 0;
    this.slideFromPrev = false;
    this.nextTime = ctx.currentTime + 0.05;
    this.timer = setInterval(() => this.tick(), LOOKAHEAD_MS);
    this.tick();
  }

  stop(): void {
    this.startToken++;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const timer of this.stepTimers) clearTimeout(timer);
    this.stepTimers.clear();
    for (const drum of this.drumSources) drum.stop();
    this.drumSources.clear();
    if (this.ctx) {
      const t = this.ctx.currentTime;
      for (const gain of [this.vca.gain, this.accentEnv.offset]) {
        gain.cancelScheduledValues(t);
        gain.setTargetAtTime(0, t, 0.01);
      }
    }
    this.onStep(-1);
  }

  private tick(): void {
    const ctx = this.ctx;
    const p = this.pattern;
    if (!ctx || !p) return;
    const dur = stepDuration(this.bpm, p.triplet);
    if (this.nextTime < ctx.currentTime - dur) {
      // Al volver de una pestaña suspendida, saltar ataques vencidos sin dispararlos de golpe.
      const missed = Math.ceil((ctx.currentTime - this.nextTime) / dur);
      this.nextTime += missed * dur;
      this.index = (this.index + missed) % p.length;
      this.slideFromPrev = false;
    }
    while (this.nextTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
      const i = this.index % p.length;
      const at = Math.max(this.nextTime, ctx.currentTime);
      this.schedule(p, i, at, dur);
      if (this.rhythm.kick && i % 4 === 0) this.scheduleDrum(ctx, "kick", at);
      if (this.rhythm.hats && i % 4 === 2) this.scheduleDrum(ctx, "hats", at);
      const indicate = () => {
        this.stepTimers.delete(timer);
        if (ctx.currentTime < at) {
          timer = setTimeout(indicate, Math.max(4, (at - ctx.currentTime) * 1000));
          this.stepTimers.add(timer);
        } else this.onStep(i);
      };
      let timer = setTimeout(indicate, (at - ctx.currentTime) * 1000);
      this.stepTimers.add(timer);
      this.nextTime += dur;
      this.index = (i + 1) % p.length;
    }
  }

  private schedule(p: Pattern, i: number, t: number, dur: number): void {
    const step = p.steps[i]!;
    const next = p.steps[(i + 1) % p.length]!;
    const g = this.vca.gain;
    const accent = this.accentEnv.offset;
    const f = this.filterEnv.offset;

    if (step.gate === "off") {
      g.setTargetAtTime(0, t, 0.005);
      accent.setTargetAtTime(0, t, 0.005);
      this.slideFromPrev = false;
      return;
    }
    if (step.gate === "on") {
      const freq = hz(midiOf(step) + this.tone.tuning);
      if (this.slideFromPrev) {
        // Slide 303: sin reataque, glide de ~60 ms hacia la nota nueva.
        this.osc.frequency.setTargetAtTime(freq, t, 0.02);
        if (!this.tone.legacySlideAccent) accent.setTargetAtTime(Number(step.accent), t, 0.008);
      } else {
        this.osc.frequency.setValueAtTime(freq, t);
        for (const [param, peak] of [[g, 0.55], [accent, Number(step.accent)]] as const) {
          param.cancelScheduledValues(t);
          param.setValueAtTime(0, t);
          param.linearRampToValueAtTime(peak, t + 0.004);
        }
        f.cancelScheduledValues(t);
        f.setValueAtTime(step.accent ? 2 : 1, t);
        f.setTargetAtTime(0, t + 0.005, noteEnvelope(this.tone, step.accent).decay);
      }
      this.slideFromPrev = step.slide && next.gate !== "off";
    }
    // Tie y slide sostienen el gate; si no, se cierra a mitad del paso.
    const held = next.gate === "tie" || (this.slideFromPrev && next.gate === "on");
    if (!held) {
      g.setTargetAtTime(0, t + dur * 0.55, 0.01);
      accent.setTargetAtTime(0, t + dur * 0.55, 0.01);
    }
  }
}
