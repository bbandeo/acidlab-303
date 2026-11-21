import { NOTES, parseBank, type Bank } from "./domain";
import { generate, SCALES, STYLES, type GenerateOptions } from "./generator";

export const DEFAULT_GENERATOR: GenerateOptions = {
  tonic: "A", scale: "menor-natural", style: "acid-techno", density: 0.7, seed: 0,
};

export const TONE_CONTROLS = {
  cutoff: { label: "Cutoff", min: 150, max: 2000, step: 10, unit: "Hz" },
  resonance: { label: "Resonance", min: 0, max: 30, step: 1, unit: "dB" },
  envelope: { label: "Envelope", min: 0, max: 100, step: 1, unit: "%" },
  decay: { label: "Decay", min: 0, max: 100, step: 1, unit: "%" },
  accent: { label: "Accent", min: 0, max: 100, step: 1, unit: "%" },
  drive: { label: "Drive", min: 0, max: 100, step: 1, unit: "%" },
};

export type ToneKey = keyof typeof TONE_CONTROLS;
export type Tone = Record<ToneKey, number> & { driveEnabled: boolean; legacySlideAccent?: true };
export const DEFAULT_TONE: Tone = {
  cutoff: 500, resonance: 12, envelope: 50, decay: 50, accent: 50, drive: 0, driveEnabled: false,
};

export interface Project {
  format: "acidlab-303";
  version: 1;
  id: string;
  bank: Bank;
  generator: GenerateOptions;
  bpm: number;
  tone: Tone;
}

export function newId(): string {
  return crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint32Array(4)), (word) =>
    word.toString(16).padStart(8, "0")).join("");
}

export function createProject(generator = DEFAULT_GENERATOR, bpm = 128, bank = generate(generator)): Project {
  return { format: "acidlab-303", version: 1, id: newId(), bank, generator, bpm, tone: { ...DEFAULT_TONE } };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Se esperaba un objeto de proyecto");
  return value as Record<string, unknown>;
}

function numberIn(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${path}: se esperaba un número entre ${min} y ${max}`);
  }
  return value;
}

export function parseGenerator(value: unknown): GenerateOptions {
  const g = object(value);
  if (!NOTES.includes(g.tonic as GenerateOptions["tonic"]) ||
      typeof g.scale !== "string" || !Object.hasOwn(SCALES, g.scale) ||
      typeof g.style !== "string" || !Object.hasOwn(STYLES, g.style) ||
      !Number.isInteger(g.seed)) throw new Error("Parámetros del generador inválidos");
  return {
    tonic: g.tonic as GenerateOptions["tonic"], scale: g.scale as GenerateOptions["scale"],
    style: g.style as GenerateOptions["style"], density: numberIn(g.density, 0, 1, "Densidad"),
    seed: numberIn(g.seed, 0, 0xffffffff, "Semilla"),
  };
}

export function projectText(project: Project): string {
  return JSON.stringify(project, null, 2) + "\n";
}

export function parseProjectText(text: string, legacyGenerator = DEFAULT_GENERATOR, legacyBpm = 128):
  { project: Project; migrated: boolean } {
  const raw = object(JSON.parse(text));
  if (!Object.hasOwn(raw, "format") && Object.hasOwn(raw, "patterns")) {
    const project = createProject(legacyGenerator, legacyBpm, parseBank(raw));
    project.tone.legacySlideAccent = true;
    return { project, migrated: true };
  }
  if (raw.format !== "acidlab-303" || raw.version !== 1) throw new Error("Formato o versión de proyecto desconocido");
  if (typeof raw.id !== "string" || !/^[\w-]{1,80}$/.test(raw.id)) throw new Error("ID de proyecto inválido");
  const storedTone = object(raw.tone);
  if (typeof storedTone.driveEnabled !== "boolean") throw new Error("El estado de Drive debe ser booleano");
  const tone: Tone = { ...DEFAULT_TONE, driveEnabled: storedTone.driveEnabled };
  if (storedTone.legacySlideAccent === true) tone.legacySlideAccent = true;
  else if (storedTone.legacySlideAccent !== undefined) throw new Error("Compatibilidad de Accent inválida");
  for (const key of Object.keys(TONE_CONTROLS) as ToneKey[]) {
    const { min, max } = TONE_CONTROLS[key];
    tone[key] = numberIn(storedTone[key], min, max, TONE_CONTROLS[key].label);
  }
  // Mantener el orden canónico de los campos al serializar y comparar revisiones.
  const project: Project = {
    format: "acidlab-303", version: 1, id: raw.id, bank: parseBank(raw.bank),
    generator: parseGenerator(raw.generator), bpm: numberIn(raw.bpm, 80, 160, "BPM"), tone,
  };
  return { project, migrated: false };
}

type Entry = { project: Project; label: string };
export type History = { current: Project; past: Entry[]; future: Entry[] };

export function createHistory(current: Project): History {
  return { current, past: [], future: [] };
}

export function commitHistory(history: History, project: Project, label: string): History {
  if (projectText(history.current) === projectText(project)) return history;
  return { current: project, past: [...history.past.slice(-99), { project: history.current, label }], future: [] };
}

export function moveHistory(history: History, direction: "undo" | "redo"): History {
  const from = direction === "undo" ? "past" : "future";
  const to = direction === "undo" ? "future" : "past";
  const entry = history[from].at(-1);
  if (!entry) return history;
  return {
    ...history, current: entry.project, [from]: history[from].slice(0, -1),
    [to]: [...history[to], { project: history.current, label: entry.label }],
  };
}
