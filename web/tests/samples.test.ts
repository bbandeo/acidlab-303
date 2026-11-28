import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { decodeSeq } from "../src/codec";
import { SAMPLES } from "../src/samples";
import { bytes, ROOT } from "./fixtures";

// Pitch 176: se listan deshabilitados. Si uno empieza a decodificar o aparece otro roto, este test avisa.
const BROKEN = [
  "10 - Kai Trancid - Desstructions.seq",
  "18 - The Proodigy - Weather Experiense.seq",
  "24 - Underground Ressistance - The Seawoolf.seq",
  "29 - Armandow - Downfal.seq",
];

it("lista cada .seq de banks/samples y solo fallan los conocidos", () => {
  const onDisk = readdirSync(join(ROOT, "banks", "samples")).filter((f) => f.endsWith(".seq"));
  expect(SAMPLES.map((s) => s.file).sort()).toEqual(onDisk.sort());
  expect(SAMPLES).toHaveLength(54);

  expect(SAMPLES.flatMap((s) => "error" in s ? [s.file] : []).sort()).toEqual(BROKEN);
  for (const s of SAMPLES) {
    if ("error" in s) expect(s.error).toContain("pitch 176");
    else expect(s.imported.pattern).toEqual(decodeSeq(bytes(`banks/samples/${s.file}`)));
  }
});
