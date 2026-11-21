import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeSeq, encodeSeq } from "../src/codec";
import { bankToJson, NOTES, parseBank, PATTERN_KEYS } from "../src/domain";
import {
  activeCount,
  generate,
  rng,
  SCALES,
  scaleNotes,
  STYLES,
  targetActive,
  type GenerateOptions,
  type ScaleId,
  type StyleId,
} from "../src/generator";
import { HAS_PY, TD3_BIN } from "./fixtures";

const SEEDS = 500;

function optsFor(seed: number): GenerateOptions {
  const r = rng(seed * 7919);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  return {
    tonic: pick(NOTES),
    scale: pick(Object.keys(SCALES) as ScaleId[]),
    style: pick(Object.keys(STYLES) as StyleId[]),
    density: Math.round(r() * 100) / 100,
    seed,
  };
}

const cases = Array.from({ length: SEEDS }, (_, i) => optsFor(i + 1));

describe(`propiedades del generador (${SEEDS} semillas)`, () => {
  it("el banco valida contra Bank v1", () => {
    for (const o of cases) expect(() => parseBank(JSON.parse(bankToJson(generate(o))))).not.toThrow();
  });

  it("toda nota `on` está en la escala", () => {
    for (const o of cases) {
      const scale = scaleNotes(o.tonic, o.scale);
      const bank = generate(o);
      for (const k of PATTERN_KEYS) {
        for (const s of bank.patterns[k].steps) if (s.gate === "on") expect(scale).toContain(s.note);
      }
    }
  });

  it("densidad de cada patrón ±1 paso del objetivo", () => {
    for (const o of cases) {
      const target = targetActive(o.density);
      const bank = generate(o);
      for (const k of PATTERN_KEYS) {
        expect(Math.abs(activeCount(bank.patterns[k]) - target)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("B, C y D difieren de A", () => {
    for (const o of cases) {
      const b = generate(o);
      const a = JSON.stringify(b.patterns.A);
      for (const k of ["B", "C", "D"] as const) expect(JSON.stringify(b.patterns[k])).not.toBe(a);
    }
  });

  it("determinista: misma semilla → mismo banco; otra semilla → otro", () => {
    for (const o of cases.slice(0, 50)) {
      expect(generate(o)).toEqual(generate({ ...o }));
      expect(generate(o)).not.toEqual(generate({ ...o, seed: o.seed + 100000 }));
    }
  });

  it("codifica a .seq sin error y hace round-trip", () => {
    for (const o of cases) {
      const bank = generate(o);
      for (const k of PATTERN_KEYS) expect(decodeSeq(encodeSeq(bank.patterns[k]))).toEqual(bank.patterns[k]);
    }
  });

  it("primer paso activo nunca es tie; accent/slide solo en `on`", () => {
    for (const o of cases) {
      const bank = generate(o);
      for (const k of PATTERN_KEYS) {
        const steps = bank.patterns[k].steps;
        expect(steps.find((s) => s.gate !== "off")?.gate ?? "on").toBe("on");
        for (const s of steps) if (s.gate !== "on") expect([s.accent, s.slide]).toEqual([false, false]);
      }
    }
  });
});

it.skipIf(!HAS_PY)("la CLI Python valida bancos generados", () => {
  const dir = mkdtempSync(join(tmpdir(), "td3-gen-"));
  for (const o of cases.slice(0, 20)) {
    const f = join(dir, `${o.seed}.json`);
    writeFileSync(f, bankToJson(generate(o)));
    expect(execFileSync(TD3_BIN, ["validate", f]).toString()).toMatch(/^OK /);
  }
});
