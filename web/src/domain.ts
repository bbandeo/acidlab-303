// Modelo Bank v1: puerto de src/td3/domain.py (ver docs/SPEC.md).
// Las constantes se comparan contra src/td3/bank.schema.json en tests/domain.test.ts.

export const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export const OCTAVES = [-1, 0, 1] as const;
export const GATES = ["on", "off", "tie"] as const;
export const PATTERN_KEYS = ["A", "B", "C", "D"] as const;
export const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
export const NAME_MAX = 64;

export type Note = (typeof NOTES)[number];
export type Octave = (typeof OCTAVES)[number];
export type Gate = (typeof GATES)[number];
export type PatternKey = (typeof PATTERN_KEYS)[number];

export interface Step {
  note: Note;
  octave: Octave;
  accent: boolean;
  slide: boolean;
  gate: Gate;
}

export interface Pattern {
  steps: Step[];
  length: number;
  triplet: boolean;
}

export interface Bank {
  version: 1;
  name: string;
  intent: string | null;
  patterns: Record<PatternKey, Pattern>;
}

const FLATS: Record<string, Note> = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#" };

export class BankError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join("\n"));
    this.name = "BankError";
    this.errors = errors;
  }
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function repr(v: unknown): string {
  return typeof v === "string" ? `'${v}'` : JSON.stringify(v) ?? String(v);
}

class Ctx {
  errors: string[] = [];
  add(path: string, msg: string): void {
    this.errors.push(`${path || "(raíz)"}: ${msg}`);
  }
}

function join(path: string, key: string | number): string {
  return path ? `${path}.${key}` : String(key);
}

function checkObject(ctx: Ctx, path: string, v: unknown, allowed: readonly string[]): v is Obj {
  if (!isObj(v)) {
    ctx.add(path, "se esperaba un objeto");
    return false;
  }
  for (const k of Object.keys(v)) {
    if (!allowed.includes(k)) ctx.add(join(path, k), "campo extra no permitido");
  }
  return true;
}

function checkBool(ctx: Ctx, path: string, v: unknown, dflt: boolean): boolean {
  if (v === undefined) return dflt;
  if (typeof v !== "boolean") ctx.add(path, `se esperaba un booleano, no ${repr(v)}`);
  return v === true;
}

function checkInt(ctx: Ctx, path: string, v: unknown): number | undefined {
  // bool no es entero (en Python sí lo es; domain.py lo rechaza explícitamente).
  if (typeof v === "boolean") {
    ctx.add(path, "se esperaba un entero, no un booleano");
    return undefined;
  }
  if (typeof v !== "number" || !Number.isInteger(v)) {
    ctx.add(path, `se esperaba un entero, no ${repr(v)}`);
    return undefined;
  }
  return v;
}

function parseStep(ctx: Ctx, path: string, v: unknown): Step {
  const step: Step = { note: "C", octave: 0, accent: false, slide: false, gate: "on" };
  if (!checkObject(ctx, path, v, ["note", "octave", "accent", "slide", "gate"])) return step;

  if (!("note" in v)) ctx.add(join(path, "note"), "campo requerido");
  else {
    const raw = typeof v.note === "string" ? (FLATS[v.note] ?? v.note) : v.note;
    if ((NOTES as readonly unknown[]).includes(raw)) step.note = raw as Note;
    else ctx.add(join(path, "note"), `valor inválido ${repr(raw)}`);
  }
  if (v.octave !== undefined) {
    const o = checkInt(ctx, join(path, "octave"), v.octave);
    if (o !== undefined) {
      if ((OCTAVES as readonly number[]).includes(o)) step.octave = o as Octave;
      else ctx.add(join(path, "octave"), `debe ser -1, 0 o 1, no ${o}`);
    }
  }
  step.accent = checkBool(ctx, join(path, "accent"), v.accent, false);
  step.slide = checkBool(ctx, join(path, "slide"), v.slide, false);
  if (v.gate !== undefined) {
    if ((GATES as readonly unknown[]).includes(v.gate)) step.gate = v.gate as Gate;
    else ctx.add(join(path, "gate"), `debe ser 'on', 'off' o 'tie', no ${repr(v.gate)}`);
  }
  return step;
}

function parsePatternIn(ctx: Ctx, path: string, v: unknown): Pattern {
  const pattern: Pattern = { steps: [], length: 16, triplet: false };
  if (!checkObject(ctx, path, v, ["steps", "length", "triplet"])) return pattern;
  const sp = join(path, "steps");
  if (!("steps" in v)) ctx.add(sp, "campo requerido");
  else if (!Array.isArray(v.steps)) ctx.add(sp, "se esperaba una lista");
  else {
    if (v.steps.length !== 16) ctx.add(sp, `debe tener exactamente 16 pasos, tiene ${v.steps.length}`);
    pattern.steps = v.steps.map((s, i) => parseStep(ctx, join(sp, i), s));
  }
  if (v.length !== undefined) {
    const n = checkInt(ctx, join(path, "length"), v.length);
    if (n !== undefined) {
      if (n >= 1 && n <= 16) pattern.length = n;
      else ctx.add(join(path, "length"), `debe estar entre 1 y 16, no ${n}`);
    }
  }
  pattern.triplet = checkBool(ctx, join(path, "triplet"), v.triplet, false);
  return pattern;
}

function finish<T>(ctx: Ctx, value: T): T {
  if (ctx.errors.length) throw new BankError(ctx.errors);
  return value;
}

export function parsePattern(data: unknown): Pattern {
  const ctx = new Ctx();
  return finish(ctx, parsePatternIn(ctx, "", data));
}

export function parseBank(data: unknown): Bank {
  const ctx = new Ctx();
  const bank: Bank = {
    version: 1,
    name: "",
    intent: null,
    patterns: { A: emptyPattern(), B: emptyPattern(), C: emptyPattern(), D: emptyPattern() },
  };
  if (!checkObject(ctx, "", data, ["version", "name", "intent", "patterns"])) return finish(ctx, bank);

  if (!("version" in data)) ctx.add("version", "campo requerido");
  else {
    const ver = checkInt(ctx, "version", data.version);
    if (ver !== undefined && ver !== 1) ctx.add("version", `solo se admite 1, no ${ver}`);
  }

  if (!("name" in data)) ctx.add("name", "campo requerido");
  else if (typeof data.name !== "string") ctx.add("name", "se esperaba un texto");
  else {
    const name = data.name;
    if (!name.length || name.length > NAME_MAX) ctx.add("name", `largo debe ser 1-${NAME_MAX}`);
    else if (!NAME_RE.test(name)) ctx.add("name", `debe cumplir ${NAME_RE.source}`);
    bank.name = name;
  }

  if (data.intent !== undefined && data.intent !== null && typeof data.intent !== "string") {
    ctx.add("intent", "se esperaba un texto o null");
  } else bank.intent = (data.intent as string | null | undefined) ?? null;

  if (!("patterns" in data)) ctx.add("patterns", "campo requerido");
  else if (checkObject(ctx, "patterns", data.patterns, PATTERN_KEYS)) {
    const ps = data.patterns;
    for (const k of PATTERN_KEYS) {
      if (!(k in ps)) ctx.add(`patterns.${k}`, "campo requerido");
      else bank.patterns[k] = parsePatternIn(ctx, `patterns.${k}`, ps[k]);
    }
  }
  return finish(ctx, bank);
}

export function parseBankText(text: string): Bank {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new BankError([`JSON mal formado (${(e as Error).message})`]);
  }
  return parseBank(data);
}

export function bankToJson(bank: Bank): string {
  return JSON.stringify(bank, null, 2) + "\n";
}

export function defaultStep(note: Note = "C"): Step {
  return { note, octave: 0, accent: false, slide: false, gate: "on" };
}

export function emptyPattern(): Pattern {
  return { steps: Array.from({ length: 16 }, () => defaultStep()), length: 16, triplet: false };
}

export function clonePattern(p: Pattern): Pattern {
  return { steps: p.steps.map((s) => ({ ...s })), length: p.length, triplet: p.triplet };
}

export function cloneBank(b: Bank): Bank {
  return {
    ...b,
    patterns: {
      A: clonePattern(b.patterns.A),
      B: clonePattern(b.patterns.B),
      C: clonePattern(b.patterns.C),
      D: clonePattern(b.patterns.D),
    },
  };
}

export function semitone(note: Note): number {
  return NOTES.indexOf(note);
}
