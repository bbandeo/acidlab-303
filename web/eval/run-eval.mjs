// Mide la búsqueda de GUÍAS con el mismo código que usa la app:  node eval/run-eval.mjs
// Falla (exit 1) si la página esperada aparece en el top-3 en menos del 90 % de las preguntas.
// Los LLM locales se evaluaron el 2026-11-28 y ninguno llegó al umbral (≥ 13/16 correctas): Qwen2.5-0.5B 9/16 y
// Qwen3-0.6B 9/16. El harness de generación se quitó junto con @huggingface/transformers.
import { readFileSync } from "node:fs";
import { normalize, search, spanish } from "../src/manual-search.ts";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const index = read("../src/manual-index.json");
const { questions } = read("./manual-qa.json");
const FILES = { es: "TD-3_Espanol_Comprimido.pdf", en: "TD-3_Pattern_Writing_Guide_(inglés).pdf" };
const isExpected = (q, h) => q.expected.some((e) => FILES[e.manual] === h.file && e.page === h.page);
const answers = (q, h) => q.keywords.every((k) => new RegExp(k).test(normalize(spanish(h))));

function measure(label, set) {
  const rows = set.map((q) => ({ q, hits: search(index, q.q) }));
  const page = rows.filter(({ q, hits }) => hits.some((h) => isExpected(q, h)));
  const text = rows.filter(({ q, hits }) => hits.some((h) => isExpected(q, h) && answers(q, h)));
  console.log(`${label}: página en el top-3 ${page.length}/${set.length}, fragmento con las palabras clave ${text.length}/${set.length}`);
  for (const r of rows.filter((r) => !text.includes(r)))
    console.log(`  ${page.includes(r) ? "sin el dato" : "sin la página"} ${r.q.id}: ${r.q.q}`);
  return page.length / set.length;
}

// Las preguntas fuera de alcance solo tenían sentido con un modelo generador; las de holdout se informan aparte.
const recall = measure("gate", questions.filter((q) => !q.outOfScope && !q.holdout));
measure("holdout", questions.filter((q) => q.holdout));
process.exit(recall >= 0.9 ? 0 : 1);
