import { expect, it } from "vitest";
import { PATTERN_KEYS } from "../src/domain";
import { seqFiles } from "../src/io";
import { createHistory, createProject, moveHistory, commitHistory, parseProjectText, projectText, DEFAULT_TONE } from "../src/project";
import { json } from "./fixtures";

it("migrates Bank v1 without changing the pattern exports, including after changing the timbre", async () => {
  const { project: legacy, migrated } = parseProjectText(JSON.stringify(json("examples/f-phrygian-rominimal.json")));
  expect(migrated).toBe(true);
  expect(legacy.tone).toEqual({ ...DEFAULT_TONE, legacySlideAccent: true });
  const edited = { ...legacy, bpm: 132, tone: { ...legacy.tone, drive: 81, driveEnabled: true } };
  expect(parseProjectText(projectText(edited))).toEqual({ project: edited, migrated: false });
  const bytes = (p: typeof legacy) => Promise.all(seqFiles(p.bank).map((file) => file.arrayBuffer()));
  expect(PATTERN_KEYS).toHaveLength(4);
  expect(await bytes(edited)).toEqual(await bytes(legacy));
  expect(() => parseProjectText(projectText(edited).replace('"version": 1', '"version": 99'))).toThrow();
});

it("retains exact revisions, limits undo and replaces the redo branch", () => {
  const initial = createProject();
  let history = createHistory(initial);
  for (let seed = 0; seed < 102; seed++) {
    history = commitHistory(history, { ...initial, generator: { ...initial.generator, seed } }, "Generar");
  }
  expect(history.past).toHaveLength(100);
  const undone = moveHistory(history, "undo");
  expect(undone.current.generator.seed).toBe(100);
  expect(moveHistory(undone, "redo").current).toBe(history.current);
  expect(commitHistory(undone, { ...undone.current, bpm: 144 }, "Tempo").future).toEqual([]);
});

it("can start a new project in a browser without the secure-context UUID API", () => {
  const uuid = crypto.randomUUID;
  try {
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
    const a = createProject();
    const b = createProject();
    expect(a.id).toMatch(/^[\w-]+$/);
    expect(a.id).not.toBe(b.id);
  } finally {
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: uuid });
  }
});

it("opens projects saved before the Tuning knob existed and round-trips tuning", () => {
  const project = createProject();
  const stored = JSON.parse(projectText(project));
  delete stored.tone.tuning;
  expect(parseProjectText(JSON.stringify(stored)).project.tone.tuning).toBe(0);
  const tuned = { ...project, tone: { ...project.tone, tuning: -5 } };
  expect(parseProjectText(projectText(tuned)).project).toEqual(tuned);
  const outOfRange = JSON.stringify({ ...stored, tone: { ...stored.tone, tuning: 13 } });
  expect(() => parseProjectText(outOfRange)).toThrow(/Tuning/);
});
