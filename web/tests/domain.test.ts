// Puerto de tests/test_domain.py + sincronía con src/td3/bank.schema.json.
import { describe, expect, it } from "vitest";
import {
  BankError,
  GATES,
  NAME_MAX,
  NAME_RE,
  NOTES,
  OCTAVES,
  parseBank,
  parseBankText,
  parsePattern,
  PATTERN_KEYS,
} from "../src/domain";
import { json } from "./fixtures";

type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function good(): Data {
  return {
    version: 1,
    name: "demo",
    patterns: Object.fromEntries(
      PATTERN_KEYS.map((k) => [k, { steps: Array.from({ length: 16 }, () => ({ note: "F" })) }]),
    ),
  };
}

function errors(data: unknown): string[] {
  try {
    parseBank(data);
  } catch (e) {
    expect(e).toBeInstanceOf(BankError);
    return (e as BankError).errors;
  }
  return [];
}

const stepBank = (step: Data): Data => {
  const d = good();
  d.patterns.A.steps[0] = step;
  return d;
};

describe("schema compartido con Python", () => {
  const schema = json("src/td3/bank.schema.json") as Data;
  const step = schema.$defs.Step.properties;
  it("constantes == bank.schema.json", () => {
    expect(step.note.enum).toEqual([...NOTES]);
    expect(step.octave.enum).toEqual([...OCTAVES]);
    expect(step.gate.enum).toEqual([...GATES]);
    expect(schema.$defs.Patterns.required).toEqual([...PATTERN_KEYS]);
    expect(schema.properties.name.pattern).toBe(NAME_RE.source);
    expect(schema.properties.name.maxLength).toBe(NAME_MAX);
    expect(schema.properties.version.const).toBe(1);
    expect(Object.keys(schema.properties)).toEqual(["version", "name", "intent", "patterns"]);
    expect(Object.keys(step)).toEqual(["note", "octave", "accent", "slide", "gate"]);
    expect(Object.keys(schema.$defs.Pattern.properties)).toEqual(["steps", "length", "triplet"]);
  });
});

describe("Bank v1", () => {
  it("defaults", () => {
    const bank = parseBank(good());
    expect(bank.patterns.A.steps[0]).toEqual({ note: "F", octave: 0, accent: false, slide: false, gate: "on" });
    expect(bank.intent).toBeNull();
    expect([bank.patterns.A.length, bank.patterns.A.triplet]).toEqual([16, false]);
  });

  it("ejemplos del repo son válidos", () => {
    expect(parseBank(json("examples/f-phrygian-rominimal.json")).name).toBe("f-phrygian-rominimal");
    expect(parseBank(json("banks/a-minor-acid-techno.json")).name).toBe("a-minor-acid-techno");
  });

  it.each([
    ["Db", "C#"],
    ["Eb", "D#"],
    ["Gb", "F#"],
    ["Ab", "G#"],
    ["Bb", "A#"],
  ])("bemol %s → %s", (flat, sharp) => {
    expect(parseBank(stepBank({ note: flat })).patterns.A.steps[0]!.note).toBe(sharp);
  });

  it.each([
    ["note", "H"],
    ["note", "Cb"],
    ["octave", 2],
    ["accent", "yes"],
    ["slide", 1],
    ["gate", "hold"],
    ["octave", true],
  ])("campo inválido %s=%j", (field, value) => {
    expect(errors(stepBank({ note: "C", [field]: value }))).toHaveLength(1);
  });

  it("note faltante", () => {
    expect(errors(stepBank({}))).toEqual(["patterns.A.steps.0.note: campo requerido"]);
  });

  it.each<[string, (d: Data) => void]>([
    ["raíz", (d) => (d.extra = 1)],
    ["patterns", (d) => (d.patterns.E = d.patterns.A)],
    ["pattern", (d) => (d.patterns.A.extra = 1)],
    ["step", (d) => (d.patterns.A.steps[0].extra = 1)],
  ])("campo extra en %s", (_, mutate) => {
    const d = good();
    mutate(d);
    expect(errors(d)[0]).toMatch(/campo extra/);
  });

  it.each([0, 15, 17])("%i pasos", (count) => {
    const d = good();
    d.patterns.C.steps = Array.from({ length: count }, () => ({ note: "F" }));
    expect(errors(d)[0]).toMatch(/^patterns\.C\.steps: debe tener exactamente 16/);
  });

  it("variación faltante", () => {
    const d = good();
    delete d.patterns.D;
    expect(errors(d)).toEqual(["patterns.D: campo requerido"]);
  });

  it.each(["", "Upper", "-x", "a_b", "a".repeat(65)])("name inválido %j", (name) => {
    const d = good();
    d.name = name;
    expect(errors(d)[0]).toMatch(/^name: /);
  });

  it.each([2, true])("version inválida %j", (v) => {
    const d = good();
    d.version = v;
    expect(errors(d)).toHaveLength(1);
  });

  it("ruta JSON en el error (mismo formato que la CLI)", () => {
    const d = good();
    d.patterns.B.steps[3].note = "H";
    expect(errors(d)).toEqual(["patterns.B.steps.3.note: valor inválido 'H'"]);
  });

  it("JSON mal formado", () => {
    expect(() => parseBankText("{not json")).toThrow(BankError);
  });

  it("length y triplet", () => {
    for (const bad of [0, 17, true, 1.5]) {
      expect(() => parsePattern({ steps: good().patterns.A.steps, length: bad })).toThrow(BankError);
    }
    expect(parsePattern({ steps: good().patterns.A.steps, length: 8, triplet: true })).toMatchObject({
      length: 8,
      triplet: true,
    });
  });
});
