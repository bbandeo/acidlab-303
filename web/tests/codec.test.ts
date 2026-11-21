// Puerto de tests/test_codec.py + paridad byte a byte con Python.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CodecError, decodeSeq, encodeSeq, encodeSysex, seqFirmware } from "../src/codec";
import { defaultStep, parseBank, PATTERN_KEYS, type Pattern, type Step } from "../src/domain";
import { bytes, HAS_PY, json, ROOT, TD3_BIN } from "./fixtures";

const REAL = ["seq/koxo-A.seq", "seq/acidiction.seq", "seq/bass_line_16.seq"];
const BANK_SEQ = PATTERN_KEYS.map((k) => `banks/a-minor-acid-techno/a-minor-acid-techno-${k}.seq`);

const st = (s: Partial<Step> & Pick<Step, "note">): Step => ({ ...defaultStep(), ...s });
const pat = (over: Partial<Pattern> = {}): Pattern => ({
  steps: Array.from({ length: 16 }, () => defaultStep()),
  length: 16,
  triplet: false,
  ...over,
});

describe("paridad con archivos reales", () => {
  it.each([...REAL, ...BANK_SEQ])("round-trip byte a byte %s", (rel) => {
    const data = bytes(rel);
    expect(encodeSeq(decodeSeq(data), seqFirmware(data))).toEqual(data);
  });

  it.each(PATTERN_KEYS)("encode del banco JSON == .seq exportado por Python (%s)", (k) => {
    const bank = parseBank(json("banks/a-minor-acid-techno.json"));
    expect(encodeSeq(bank.patterns[k])).toEqual(bytes(`banks/a-minor-acid-techno/a-minor-acid-techno-${k}.seq`));
  });

  it.skipIf(!HAS_PY)("encode del ejemplo == td3 export (Python, en vivo)", () => {
    const out = mkdtempSync(join(tmpdir(), "td3-"));
    const example = join(ROOT, "examples/f-phrygian-rominimal.json");
    execFileSync(TD3_BIN, ["export", example, "--out", out]);
    const bank = parseBank(JSON.parse(readFileSync(example, "utf-8")));
    for (const k of PATTERN_KEYS) {
      const py = new Uint8Array(readFileSync(join(out, `${bank.name}-${k}.seq`)));
      expect(encodeSeq(bank.patterns[k])).toEqual(py);
    }
  });
});

describe("contenido de los .seq reales", () => {
  it("firmware", () => {
    expect(["1.3.7", "1.2.6"]).toContain(seqFirmware(bytes("seq/acidiction.seq")));
  });
  it("acidiction", () => {
    const p = decodeSeq(bytes("seq/acidiction.seq"));
    expect(p.length).toBe(8);
  });
  it("bass_line_16", () => {
    const on = decodeSeq(bytes("seq/bass_line_16.seq")).steps.filter((s) => s.gate === "on");
    expect(on.slice(0, 3).map((s) => s.accent)).toEqual([true, true, true]);
    expect(on.flatMap((s, i) => (s.slide ? [i] : []))).toEqual([0, 4, 7]);
  });
  it("koxo-A", () => {
    const p = decodeSeq(bytes("seq/koxo-A.seq"));
    expect(p.steps.filter((s) => s.gate === "on")).toHaveLength(16);
    expect([p.steps[0]!.note, p.steps[0]!.octave]).toEqual(["C#", 0]);
  });
});

describe("modelo", () => {
  it("round-trip del modelo", () => {
    const steps = [
      st({ note: "D", octave: -1, accent: true, slide: true }),
      st({ note: "A#", octave: 1, accent: true }),
      st({ note: "A#", octave: 1, gate: "tie" }),
      st({ note: "C", gate: "off" }),
      st({ note: "B", slide: true }),
      ...Array.from({ length: 11 }, () => defaultStep()),
    ];
    const p = pat({ steps, length: 12, triplet: true });
    expect(decodeSeq(encodeSeq(p))).toEqual(p);
  });

  it("normaliza flags ignorados", () => {
    const steps = [
      st({ note: "E", accent: true, slide: true, gate: "tie" }),
      st({ note: "G", accent: true }),
      ...Array.from({ length: 14 }, () => st({ note: "C", accent: true, gate: "off" })),
    ];
    const out = decodeSeq(encodeSeq(pat({ steps })));
    expect(out.steps[0]).toEqual(st({ note: "C", gate: "tie" }));
    expect(out.steps[1]).toEqual(st({ note: "G", accent: true }));
    expect(out.steps[2]).toEqual(st({ note: "C", gate: "off" }));
  });

  it("pausa: tie y rest sin consumir nota", () => {
    const steps = [
      st({ note: "C", gate: "off" }),
      st({ note: "D#", octave: 1 }),
      ...Array.from({ length: 14 }, () => st({ note: "C", gate: "tie" })),
    ];
    const body = encodeSeq(pat({ steps })).subarray(36);
    expect([...body.subarray(0, 2)]).toEqual([2, 7]);
    expect([...body.subarray(102, 106)]).toEqual([0, 3, 0, 0]);
    expect([...body.subarray(106, 110)]).toEqual([0, 1, 0, 0]);
  });
});

describe("sysex", () => {
  it("estructura", () => {
    const p = decodeSeq(bytes("seq/bass_line_16.seq"));
    const sx = encodeSysex(p, 2, 5);
    expect(sx).toHaveLength(123);
    expect([...sx.subarray(0, 8)]).toEqual([0xf0, 0, 0x20, 0x32, 0, 1, 0x0a, 0x78]);
    expect([...sx.subarray(8, 12)]).toEqual([2, 5, 0, 0]);
    expect(sx.at(-1)).toBe(0xf7);
    expect(sx.subarray(12, -1)).toEqual(encodeSeq(p).subarray(36));
  });
  it.each([
    [4, 0],
    [-1, 0],
    [0, 16],
    [0, -1],
  ])("argumentos fuera de rango (%i, %i)", (g, s) => {
    expect(() => encodeSysex(pat(), g, s)).toThrow(/fuera de/);
  });
});

describe("errores de decode", () => {
  const koxo = () => bytes("seq/koxo-A.seq");
  const mutated = (i: number, v: number) => {
    const d = Uint8Array.from(koxo());
    d[i] = v;
    return d;
  };
  it.each([
    ["vacío", new Uint8Array(0), /largo/],
    ["corto", koxo().subarray(0, -1), /largo/],
    ["magic", mutated(0, 0), /magic/],
    ["cabecera", mutated(7, 9), /cabecera/],
    ["nibbles", mutated(36 + 3, 0x1f), /nibbles/],
    ["pitch", mutated(36, 0), /pitch/],
    ["length", mutated(36 + 98, 0), /length/],
  ] as const)("%s", (_, data, msg) => {
    expect(() => decodeSeq(data)).toThrow(CodecError);
    expect(() => decodeSeq(data)).toThrow(msg);
  });
  it("firmware inválido", () => {
    expect(() => encodeSeq(pat(), "1.3")).toThrow(/firmware/);
  });
});
