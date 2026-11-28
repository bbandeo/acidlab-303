// Genera src/manual-index.json a partir de docs/guides/*.pdf. Requiere pdftotext y pdfinfo (poppler-utils).
// Uso: npm run index:manuals
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const GUIDES = fileURLToPath(new URL("../../docs/guides/", import.meta.url));
const OUT = fileURLToPath(new URL("../src/manual-index.json", import.meta.url));
// Traducción literal de los fragmentos en inglés, para buscar y mostrar en español; el resultado abre el PDF original.
const ES = JSON.parse(readFileSync(new URL("./manual-translations.json", import.meta.url), "utf8"));
delete ES._nota;
const MAX = 700; // caracteres por fragmento
const MIN = 60;

// ponytail: reglas fijas para el corpus actual; un PDF nuevo entra sin recortes y hay que revisar su salida.
const RULES = {
  "TD-3_Espanol_Comprimido.pdf": {
    // 1 portada, 2-3 seguridad/legal, 4-5 diagramas en 12 idiomas, 6 dibujo con números, 9 versión inglesa de la 10, 15 registro.
    skip: [1, 2, 3, 4, 5, 6, 9, 15],
    // Dobles páginas a varias columnas: sin recortar, pdftotext intercala las columnas.
    columns: { pages: [7, 8, 10, 11], cuts: [0, 205, 408, 598, 805] },
    perItem: [7], // un control del panel por fragmento
    english: [14], // especificaciones
  },
  "TD-3_Pattern_Writing_Guide_(inglés).pdf": { english: [1] },
};
const NOISE = /^\s*(\d+\s+)?(TD-3|Quick Start Guide|\(ES\) Paso|Operaci[oó]n TD-3|uaci[oó]n\)|TD-3 (Controles|Puesta en marcha))/;
const ITEM = /^\s*(\(\d+\)|\d+\.\s)/;

function pageText(path, page, cuts) {
  const run = (...crop) => execFileSync("pdftotext", ["-layout", "-f", `${page}`, "-l", `${page}`, ...crop, path, "-"], { encoding: "utf8" });
  if (!cuts) return run();
  return cuts.slice(1).map((end, i) => run("-x", `${cuts[i]}`, "-y", "30", "-W", `${end - cuts[i]}`, "-H", "566")).join("\n");
}

function chunks(text, perItem) {
  const lines = text.replace(/\f/g, "\n").split("\n").filter((l) => !NOISE.test(l) && !/^\s*\d+\s*$/.test(l)); // fuera cabeceras y folios
  const units = [];
  let unit = "", heading = false;
  const push = () => { if (unit) units.push({ text: unit, heading }); unit = ""; heading = false; };
  lines.forEach((raw, i) => {
    const line = raw.trim().replace(/\s+/g, " ");
    if (!line) return push();
    const next = lines.slice(i + 1).find((l) => l.trim()) ?? "";
    const isHeading = !ITEM.test(raw) && line.length <= 50 && !/[.,;:)]$/.test(line) &&
      (/^[^a-záéíóúñ]{5,}$/.test(line) || /^\s*1?\d\.\s/.test(next));
    if (isHeading || ITEM.test(raw)) push();
    unit += (unit ? " " : "") + line;
    if (isHeading) { heading = true; push(); }
  });
  push();

  const out = [];
  let cur = "";
  for (const u of units) {
    const full = cur.length + u.text.length >= MAX;
    const split = perItem ? ITEM.test(u.text) && cur.length >= MIN : (u.heading && cur.length >= MAX / 2) || full;
    if (cur && split) { out.push(cur); cur = ""; }
    cur += (cur ? " " : "") + u.text;
  }
  if (cur) out.push(cur);
  return out.filter((c) => c.length >= MIN);
}

const index = [];
const used = new Set();
for (const file of readdirSync(GUIDES).filter((f) => f.endsWith(".pdf")).sort()) {
  const path = GUIDES + file;
  const rules = RULES[file] ?? {};
  const pages = Number(execFileSync("pdfinfo", [path], { encoding: "utf8" }).match(/^Pages:\s+(\d+)/m)[1]);
  const manual = file.slice(0, -4).replace(/_/g, " ");
  for (let page = 1; page <= pages; page++) {
    if (rules.skip?.includes(page)) continue;
    const cuts = rules.columns?.pages.includes(page) ? rules.columns.cuts : undefined;
    for (const text of chunks(pageText(path, page, cuts), rules.perItem?.includes(page))) {
      if (!rules.english?.includes(page)) { index.push({ manual, file, page, text }); continue; }
      const key = Object.keys(ES).find((k) => text.startsWith(k));
      if (!key) throw new Error(`Falta traducir (manual-translations.json) ${file} p.${page}: ${text.slice(0, 40)}`);
      used.add(key);
      index.push({ manual, file, page, text, es: ES[key] });
    }
  }
}
const unused = Object.keys(ES).filter((k) => !used.has(k));
if (unused.length) throw new Error(`Traducciones sin fragmento: ${unused.join(" | ")}`);
writeFileSync(OUT, JSON.stringify(index) + "\n");
console.log(`${index.length} fragmentos, ${index.reduce((n, c) => n + c.text.length, 0)} caracteres → ${OUT}`);
