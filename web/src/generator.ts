// Generador local de bancos (4 variaciones A–D). Determinista: misma entrada + semilla → mismo banco.
// Reglas tomadas de .claude/skills/td3-patterns/SKILL.md: densidad = pasos activos / 16,
// pasos fuertes sobre tónica y quinta, la nota de color del modo con acento,
// B/C/D = variaciones de A (acentos, slides/ties, octavas/gates).

import {
  NOTES,
  type Bank,
  type Note,
  type Octave,
  type Pattern,
  type PatternKey,
  type Step,
  clonePattern,
} from "./domain";

export const SCALES = {
  "menor-natural": { label: "Menor natural", intervals: [0, 2, 3, 5, 7, 8, 10], color: 8 },
  frigio: { label: "Frigio", intervals: [0, 1, 3, 5, 7, 8, 10], color: 1 },
  dorico: { label: "Dórico", intervals: [0, 2, 3, 5, 7, 9, 10], color: 9 },
  "menor-armonica": { label: "Menor armónica", intervals: [0, 2, 3, 5, 7, 8, 11], color: 11 },
} as const;
export type ScaleId = keyof typeof SCALES;

interface StyleProfile {
  label: string;
  accent: number; // prob. de acento en pasos débiles
  /**
   * Prob. de acento en pasos fuertes (incluido el paso 1) y en la nota de color. Sin definir se usa
   * la regla original: paso 1 y nota de color siempre, fuertes 0.6, y B invierte el 45 % de los acentos.
   */
  strongAccent?: number;
  slide: number; // prob. de slide hacia la nota siguiente
  tie: number; // prob. de que un paso activo prolongue la nota anterior
  up: number; // prob. de octava +1
  down: number; // prob. de octava −1
  /**
   * Prioridad de posiciones (0-indexadas) después del paso 0: cada grupo se mezcla y se llena en orden,
   * el resto va al final. Default: fuertes → contratiempos. Pares contiguos permiten slide/tie con baja densidad.
   */
  order?: readonly (readonly number[])[];
}

export const STYLES = {
  "acid-techno": { label: "Acid techno", accent: 0.35, slide: 0.3, tie: 0.12, up: 0.22, down: 0.15 },
  rominimal: { label: "Rominimal", accent: 0.25, slide: 0.2, tie: 0.22, up: 0.1, down: 0.28 },
  minimal: { label: "Minimal", accent: 0.18, slide: 0.12, tie: 0.1, up: 0.06, down: 0.2 },
  // Calibrados con guías de producción (cualitativas) y, en house, con los 26 patrones de AcidMachine
  // (ties ≈ 0.02 por paso activo). Límite: el estilo no fija densidad ni BPM;
  // densidad sugerida: jungle 25–45 %, phonk 35–55 %, house 40–55 %, dreamy 45–65 %.
  // Sub largo, 170 BPM: golpes sincopados (1, "a" del 2, 3) con su paso siguiente para sostener.
  jungle: { label: "Jungle", accent: 0.12, strongAccent: 0.15, slide: 0.12, tie: 0.45, up: 0.1, down: 0.05, order: [[1, 7, 8], [10, 11, 14]] },
  // 808 con glide, ~130 BPM, frigio: patrón punteado (1, 7, 11) con la cola en el paso siguiente.
  phonk: { label: "Phonk", accent: 0.15, strongAccent: 0.25, slide: 0.3, tie: 0.4, up: 0.12, down: 0.05, order: [[6, 10], [1, 7, 11], [3, 12]] },
  // Corto y saltos de octava, ~122 BPM: contratiempos primero, algún paso pegado para el slide.
  house: { label: "House", accent: 0.15, strongAccent: 0.2, slide: 0.15, tie: 0.05, up: 0.2, down: 0.05, order: [[2, 6, 10, 14], [3, 11]] },
  // Legato, pocos acentos, ~125 BPM: pares de pasos contiguos.
  dreamy: { label: "Dreamy", accent: 0.1, strongAccent: 0.1, slide: 0.3, tie: 0.35, up: 0.2, down: 0.05, order: [[1, 8, 9], [4, 5, 12, 13]] },
} as const satisfies Record<string, StyleProfile>;
export type StyleId = keyof typeof STYLES;

export interface GenerateOptions {
  tonic: Note;
  scale: ScaleId;
  density: number; // 0..1
  style: StyleId;
  seed: number;
}

const STRONG = [0, 4, 8, 12];
const OFFBEAT = [2, 6, 10, 14];

/** PRNG mulberry32: rápido, 32 bits, reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
const chance = (r: Rand, p: number) => r() < p;
const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;

function shuffle<T>(r: Rand, xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
  return xs;
}

export function targetActive(density: number): number {
  return Math.min(16, Math.max(1, Math.round(density * 16)));
}

export function scaleNotes(tonic: Note, scale: ScaleId): Note[] {
  const t = NOTES.indexOf(tonic);
  return SCALES[scale].intervals.map((i) => NOTES[(t + i) % 12]!);
}

function transpose(tonic: Note, semis: number): Note {
  return NOTES[(NOTES.indexOf(tonic) + semis) % 12]!;
}

function activeCount(p: Pattern): number {
  return p.steps.filter((s) => s.gate !== "off").length;
}

/**
 * Forma canónica, igual a la que produce decodeSeq: accent/slide solo en `on`,
 * `tie` lleva la nota del último `on`, `off` es C octava 0 (la nota de off/tie se ignora en el equipo).
 */
function normalize(p: Pattern): Pattern {
  // Un tie sin nota previa no tiene sentido musical: el primer paso activo siempre dispara.
  const first = p.steps.find((s) => s.gate !== "off");
  if (first && first.gate === "tie") first.gate = "on";
  let last: [Note, Octave] = ["C", 0];
  for (const s of p.steps) {
    if (s.gate === "on") {
      last = [s.note, s.octave];
      continue;
    }
    s.accent = false;
    s.slide = false;
    [s.note, s.octave] = s.gate === "tie" ? last : ["C", 0];
  }
  return p;
}

function randomOctave(r: Rand, st: StyleProfile): Octave {
  const x = r();
  if (x < st.up) return 1;
  if (x < st.up + st.down) return -1;
  return 0;
}

function base(opts: GenerateOptions, r: Rand): Pattern {
  const st: StyleProfile = STYLES[opts.style];
  const notes = scaleNotes(opts.tonic, opts.scale);
  const fifth = transpose(opts.tonic, 7);
  const color = transpose(opts.tonic, SCALES[opts.scale].color);
  const n = targetActive(opts.density);

  // Prioridad de posiciones: paso 0 → grupos del estilo (default fuertes → contratiempos) → resto, cada grupo mezclado.
  const groups = st.order ?? [STRONG.slice(1), OFFBEAT];
  const others = Array.from({ length: 16 }, (_, i) => i).filter((i) => i > 0 && !groups.some((g) => g.includes(i)));
  const order = [0, ...groups.flatMap((g) => shuffle(r, [...g])), ...shuffle(r, others)];
  const active = new Set(order.slice(0, n));

  // Peso de grados: tónica y quinta dominan; el resto de la escala completa la línea.
  const weighted: Note[] = [opts.tonic, opts.tonic, opts.tonic, fifth, fifth, ...notes];
  let colorPlaced = false;

  const steps: Step[] = Array.from({ length: 16 }, (_, i) => {
    const step: Step = { note: opts.tonic, octave: 0, accent: false, slide: false, gate: "off" };
    if (!active.has(i)) return step;
    step.gate = i > 0 && active.has(i - 1) && chance(r, st.tie) ? "tie" : "on";
    if (STRONG.includes(i)) {
      step.note = i === 0 || chance(r, 0.65) ? opts.tonic : fifth;
      step.octave = i === 0 ? pick(r, [0, -1] as const) : randomOctave(r, st);
      step.accent = st.strongAccent === undefined ? i === 0 || chance(r, 0.6) : chance(r, st.strongAccent);
    } else {
      const useColor = !colorPlaced ? chance(r, 0.5) : chance(r, 0.15);
      step.note = useColor ? color : pick(r, weighted);
      step.octave = randomOctave(r, st);
      step.accent = useColor ? colorAccent(r, st) : chance(r, st.accent);
      if (useColor && step.gate === "on") colorPlaced = true;
    }
    step.slide = active.has((i + 1) % 16) && chance(r, st.slide);
    return step;
  });

  // Garantiza la nota de color del modo (con acento según el estilo) si hay algún paso débil `on`.
  if (!colorPlaced) {
    const weak = steps.findIndex((s, i) => s.gate === "on" && !STRONG.includes(i));
    if (weak >= 0) Object.assign(steps[weak]!, { note: color, accent: colorAccent(r, st) });
  }
  return normalize({ steps, length: 16, triplet: false });
}

/** Sin `strongAccent` la nota de color siempre lleva acento y no consume el PRNG (bancos previos intactos). */
function colorAccent(r: Rand, st: StyleProfile): boolean {
  return st.strongAccent === undefined || chance(r, st.strongAccent);
}

/**
 * B: reubica acentos (la nota de color conserva el suyo). Con `strongAccent`, agregar un acento usa la
 * prob. de pasos débiles del estilo para no inflar el total; sin él, invierte el 45 % en ambos sentidos.
 */
function varyAccents(a: Pattern, r: Rand, color: Note, st: StyleProfile): Pattern {
  const p = clonePattern(a);
  for (const s of p.steps) {
    if (s.gate !== "on" || s.note === color) continue;
    const flip = st.strongAccent === undefined || s.accent ? 0.45 : st.accent;
    if (chance(r, flip)) s.accent = !s.accent;
  }
  return p;
}

/** C: cambia slides y ties sin tocar la cantidad de pasos activos. */
function varySlidesTies(a: Pattern, r: Rand): Pattern {
  const p = clonePattern(a);
  p.steps.forEach((s, i) => {
    if (s.gate === "off") return;
    const prevActive = i > 0 && p.steps[i - 1]!.gate !== "off";
    if (s.gate === "on" && prevActive && chance(r, 0.2)) s.gate = "tie";
    else if (s.gate === "tie" && chance(r, 0.5)) s.gate = "on";
    if (s.gate === "on") s.slide = p.steps[(i + 1) % 16]!.gate !== "off" && chance(r, 0.4);
  });
  return p;
}

/** D: mueve octavas y cambia un paso activo de lugar (densidad exacta). */
function varyOctavesGates(a: Pattern, r: Rand): Pattern {
  const p = clonePattern(a);
  for (const s of p.steps) {
    if (s.gate === "on" && chance(r, 0.35)) s.octave = pick(r, ([-1, 0, 1] as const).filter((o) => o !== s.octave));
  }
  const offs = p.steps.flatMap((s, i) => (s.gate === "off" ? [i] : []));
  const movable = p.steps.flatMap((s, i) => (s.gate !== "off" && i !== 0 && !STRONG.includes(i) ? [i] : []));
  if (offs.length && movable.length) {
    const from = pick(r, movable);
    const to = pick(r, offs);
    const src = p.steps[from]!;
    p.steps[to] = { ...src, gate: "on" };
    p.steps[from] = { note: src.note, octave: 0, accent: false, slide: false, gate: "off" };
  }
  return p;
}

function samePattern(a: Pattern, b: Pattern): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Último recurso para que una variación nunca repita A: alterna el acento del primer paso `on` débil. */
function forceDifferent(p: Pattern): void {
  const s = p.steps.find((x, i) => x.gate === "on" && i !== 0) ?? p.steps.find((x) => x.gate === "on");
  if (s) s.accent = !s.accent;
}

function noteSlug(n: Note): string {
  return n.toLowerCase().replace("#", "s");
}

export function bankName(opts: GenerateOptions): string {
  return `${noteSlug(opts.tonic)}-${opts.scale}-${opts.style}-${opts.seed}`;
}

export function generate(opts: GenerateOptions): Bank {
  const r = rng(opts.seed);
  const color = transpose(opts.tonic, SCALES[opts.scale].color);
  const A = base(opts, r);
  const variants: Record<Exclude<PatternKey, "A">, (x: Pattern) => Pattern> = {
    B: (x) => varyAccents(x, r, color, STYLES[opts.style]),
    C: (x) => varySlidesTies(x, r),
    D: (x) => varyOctavesGates(x, r),
  };
  const out = { A } as Record<PatternKey, Pattern>;
  for (const k of ["B", "C", "D"] as const) {
    let p = normalize(variants[k](A));
    for (let i = 0; i < 4 && samePattern(p, A); i++) p = normalize(variants[k](A));
    if (samePattern(p, A)) forceDifferent(p);
    out[k] = p;
  }
  return {
    version: 1,
    name: bankName(opts),
    intent: `${opts.tonic} ${SCALES[opts.scale].label.toLowerCase()}, densidad ${Math.round(
      opts.density * 100,
    )}%, ${STYLES[opts.style].label} (semilla ${opts.seed})`,
    patterns: out,
  };
}

export { activeCount };
