// Genera public/icon-192.png, icon-512.png e icon.svg sin dependencias (PNG RGBA + zlib).
// Diseño: fondo oscuro con 16 pasos (4×4) naranjas; los "acentos" más brillantes. Zona segura maskable: 80%.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BG = [0x11, 0x11, 0x11];
const ON = [0xff, 0x6a, 0x1a];
const DIM = [0x5a, 0x2a, 0x10];
const LIT = [1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const inner = size * 0.56; // grilla dentro de la zona segura maskable
  const off = (size - inner) / 2;
  const cell = inner / 4;
  const gap = cell * 0.14;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let col = BG;
      const gx = Math.floor((x - off) / cell);
      const gy = Math.floor((y - off) / cell);
      if (gx >= 0 && gx < 4 && gy >= 0 && gy < 4) {
        const lx = x - off - gx * cell;
        const ly = y - off - gy * cell;
        if (lx > gap && ly > gap && lx < cell - gap && ly < cell - gap) col = LIT[gy * 4 + gx] ? ON : DIM;
      }
      const p = y * (size * 4 + 1) + 1 + x * 4;
      raw[p] = col[0];
      raw[p + 1] = col[1];
      raw[p + 2] = col[2];
      raw[p + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function svg() {
  const hexc = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
  const rects = LIT.map((on, i) => {
    const x = 22 + (i % 4) * 14 + 2;
    const y = 22 + Math.floor(i / 4) * 14 + 2;
    return `<rect x="${x}" y="${y}" width="10" height="10" rx="1.5" fill="${hexc(on ? ON : DIM)}"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="${hexc(BG)}"/>${rects}</svg>\n`;
}

const out = new URL("../public/", import.meta.url);
writeFileSync(new URL("icon-192.png", out), png(192));
writeFileSync(new URL("icon-512.png", out), png(512));
writeFileSync(new URL("icon.svg", out), svg());
console.log("íconos generados en public/");
