import { expect, it } from "vitest";
import { DEFAULT_TONE } from "../src/project";
import { noteEnvelope, driveCurve, driveLevels, volumeGain } from "../src/synth";

it("uses legacy attacks at migration values and preserves unaccented amplitude", () => {
  expect(noteEnvelope(DEFAULT_TONE, false)).toEqual({ peak: 0.55, excursion: 1250, decay: 0.12 });
  expect(noteEnvelope(DEFAULT_TONE, true)).toEqual({ peak: 0.9, excursion: 2500, decay: 0.06 });
  const tone = { ...DEFAULT_TONE, envelope: 0, accent: 0, decay: 90 };
  expect(noteEnvelope(tone, true).peak).toEqual(noteEnvelope(tone, false).peak);
  expect(noteEnvelope(tone, false).excursion).toBe(0);
  expect(noteEnvelope(tone, false).decay).toBeGreaterThan(0.12);
});

it("varies the compensated saturation curve while retaining symmetry", () => {
  const gentle = driveLevels(10);
  const hot = driveLevels(90);
  expect(hot.input).toBeGreaterThan(gentle.input);
  expect(hot.output).toBeLessThan(gentle.output);
  const curve = driveCurve();
  expect(curve[0]).toBeCloseTo(-curve.at(-1)!);
  expect(curve[1024]).toBe(0);
});

it("keeps the previous output level at the default volume", () => {
  expect(volumeGain(70)).toBeCloseTo(0.98);
  expect(volumeGain(0)).toBe(0);
});
