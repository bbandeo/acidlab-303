// Codec .seq / SysEx del TD-3: puerto 1:1 de src/td3/codec.py (ver docs/FORMAT.md). Puro: sin I/O.
// La paridad byte a byte con Python se prueba en tests/codec.test.ts con las fixtures reales.

import { NOTES, type Note, type Octave, type Pattern, type Step } from "./domain";

const MAGIC = [0x23, 0x98, 0x54, 0x76];
const MODEL = "TD-3";
const FW_CHARS = 5;
const BODY_LEN = 110;
export const SEQ_LEN = 36 + BODY_LEN;
const REST_PITCH = 0x18;
const SYSEX_HEAD = [0xf0, 0x00, 0x20, 0x32, 0x00, 0x01, 0x0a, 0x78];

export class CodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodecError";
  }
}

function nibbles(values: number[]): number[] {
  return values.flatMap((v) => [v >> 4, v & 0xf]);
}

function mask(bits: boolean[]): number[] {
  const word = (bs: boolean[]) => bs.reduce((acc, b, i) => (b ? acc | (1 << i) : acc), 0);
  const lo = word(bits.slice(0, 8));
  const hi = word(bits.slice(8));
  return [lo >> 4, lo & 0xf, hi >> 4, hi & 0xf];
}

function unmask(raw: Uint8Array): boolean[] {
  const words = [(raw[0]! << 4) | raw[1]!, (raw[2]! << 4) | raw[3]!];
  return words.flatMap((w) => Array.from({ length: 8 }, (_, i) => ((w >> i) & 1) === 1));
}

function encodeBody(pattern: Pattern): number[] {
  const pitches: number[] = [];
  const accents: number[] = [];
  const slides: number[] = [];
  const tie: boolean[] = [];
  const rest: boolean[] = [];
  for (const step of pattern.steps) {
    rest.push(step.gate === "off");
    tie.push(step.gate !== "tie");
    if (step.gate === "on") {
      pitches.push(24 + 12 * step.octave + NOTES.indexOf(step.note));
      accents.push(step.accent ? 1 : 0);
      slides.push(step.slide ? 1 : 0);
    }
  }
  const pad = 16 - pitches.length;
  const fill = (xs: number[], v: number) => xs.concat(Array<number>(pad).fill(v));
  return [
    ...nibbles(fill(pitches, REST_PITCH)),
    ...nibbles(fill(accents, 0)),
    ...nibbles(fill(slides, 0)),
    ...nibbles([pattern.triplet ? 1 : 0, pattern.length, 0]),
    ...mask(tie),
    ...mask(rest),
  ];
}

function decodeBody(body: Uint8Array): Pattern {
  if (body.some((b) => b > 0xf)) {
    throw new CodecError("el cuerpo del patrón tiene bytes que no son nibbles (> 0x0F)");
  }
  const vals: number[] = [];
  for (let i = 0; i < 102; i += 2) vals.push((body[i]! << 4) | body[i + 1]!);
  const pitches = vals.slice(0, 16);
  const accents = vals.slice(16, 32);
  const slides = vals.slice(32, 48);
  const triplet = vals[48]!;
  const length = vals[49]!;
  if (triplet > 1 || [...accents, ...slides].some((v) => v > 1)) {
    throw new CodecError("triplet, accent y slide deben ser 0 o 1");
  }
  if (length < 1 || length > 16) throw new CodecError(`length ${length} fuera de 1-16`);
  const ties = unmask(body.subarray(102, 106));
  const rests = unmask(body.subarray(106, 110));

  const steps: Step[] = [];
  let queue = 0;
  let last: [Note, Octave] = ["C", 0];
  for (let i = 0; i < 16; i++) {
    if (rests[i]) {
      steps.push({ note: "C", octave: 0, accent: false, slide: false, gate: "off" });
    } else if (ties[i]) {
      const pitch = pitches[queue]!;
      if (pitch < 12 || pitch > 47) {
        throw new CodecError(`pitch ${pitch} fuera del rango 12-47 (octave -1..+1)`);
      }
      const octave = (Math.floor((pitch - 24) / 12) as Octave);
      const note = NOTES[(pitch - 24 - 12 * octave)]!;
      last = [note, octave];
      steps.push({ note, octave, accent: accents[queue] === 1, slide: slides[queue] === 1, gate: "on" });
      queue++;
    } else {
      steps.push({ note: last[0], octave: last[1], accent: false, slide: false, gate: "tie" });
    }
  }
  return { steps, length, triplet: triplet === 1 };
}

function u32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, false);
}

function utf16be(s: string): number[] {
  return [...s].flatMap((c) => {
    const code = c.charCodeAt(0);
    return [code >> 8, code & 0xff];
  });
}

function decodeUtf16be(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-16be", { fatal: true }).decode(bytes);
  } catch {
    throw new CodecError("cabecera del .seq mal formada (texto inválido)");
  }
}

function be32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function parse(data: Uint8Array): [string, Uint8Array] {
  if (data.length !== SEQ_LEN) {
    throw new CodecError(`largo ${data.length} inválido: un .seq mide ${SEQ_LEN} bytes`);
  }
  if (!MAGIC.every((b, i) => data[i] === b)) {
    throw new CodecError("no es un .seq de TD-3 (magic incorrecto)");
  }
  if (
    u32(data, 4) !== 8 ||
    u32(data, 16) !== 2 * FW_CHARS ||
    u32(data, 30) !== BODY_LEN + 2 ||
    data[34] !== 0 ||
    data[35] !== 0
  ) {
    throw new CodecError("cabecera del .seq mal formada");
  }
  const model = decodeUtf16be(data.subarray(8, 16));
  const firmware = decodeUtf16be(data.subarray(20, 30));
  if (model !== MODEL) throw new CodecError(`modelo '${model}' no soportado (se esperaba '${MODEL}')`);
  return [firmware, data.subarray(36)];
}

export function encodeSeq(pattern: Pattern, firmware = "1.3.7"): Uint8Array {
  if (firmware.length !== FW_CHARS) {
    throw new CodecError(`firmware '${firmware}' inválido: debe tener ${FW_CHARS} caracteres`);
  }
  return Uint8Array.from([
    ...MAGIC,
    ...be32(8),
    ...utf16be(MODEL),
    ...be32(2 * FW_CHARS),
    ...utf16be(firmware),
    ...be32(BODY_LEN + 2),
    0,
    0,
    ...encodeBody(pattern),
  ]);
}

export function decodeSeq(data: Uint8Array): Pattern {
  return decodeBody(parse(data)[1]);
}

export function seqFirmware(data: Uint8Array): string {
  return parse(data)[0];
}

export function encodeSysex(pattern: Pattern, group: number, slot: number): Uint8Array {
  if (!Number.isInteger(group) || group < 0 || group > 3) throw new CodecError(`group ${group} fuera de 0-3`);
  if (!Number.isInteger(slot) || slot < 0 || slot > 15) throw new CodecError(`slot ${slot} fuera de 0-15`);
  return Uint8Array.from([...SYSEX_HEAD, group, slot, 0, 0, ...encodeBody(pattern), 0xf7]);
}
