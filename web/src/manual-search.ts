// Búsqueda sin modelo (BM25) sobre los fragmentos de los manuales.
// Sin imports ni sintaxis TS no borrable: lo usan la app y eval/run-eval.mjs (Node).

export interface Chunk {
  manual: string;
  file: string;
  page: number;
  text: string;
  /** Traducción al español de un fragmento en inglés: se busca y se muestra ella. */
  es?: string;
}
export interface Hit extends Chunk {
  score: number;
}

const STOP = new Set(
  ("a al algo antes como con cual cuando cuanto cuantos de del desde donde el ella en entre es esa ese eso esta este esto " +
    "hace hacer hay la las le lo los mas me mi mientras muy no o para pasa pero poner por puede puedo que quien se si sin " +
    "sirve sobre su sus tengo tiene tener tu un una uno unos usar uso usarlo y ya yo " +
    "an and are as at be by for from in is it of on or that the this to will with td").split(" "),
);

export const normalize = (s: string): string => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

// ponytail: stemming por prefijo de 5 letras; no cruza idiomas (para eso harían falta embeddings).
export const tokenize = (s: string): string[] =>
  normalize(s)
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => w.slice(0, 5));

export const spanish = (c: Chunk): string => c.es ?? c.text;

const K1 = 1.5;
const B = 0.75;

export function search<C extends Chunk>(index: readonly C[], query: string, k = 3): (C & Hit)[] {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length || !index.length) return [];
  // ponytail: retokeniza el corpus en cada consulta; son ~80 fragmentos, cachear si crece 100×.
  const docs = index.map((c) => tokenize(spanish(c)));
  const avg = docs.reduce((n, d) => n + d.length, 0) / docs.length;
  const idf = terms.map((t) => {
    const df = docs.filter((d) => d.includes(t)).length;
    return Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
  });
  const ranked = index
    .map((chunk, i) => {
      const d = docs[i] ?? [];
      const score = terms.reduce((sum, t, j) => {
        const tf = d.filter((w) => w === t).length;
        return sum + ((idf[j] ?? 0) * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * d.length) / avg));
      }, 0);
      return { ...chunk, score };
    })
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, k);
  // Cupo: el último lugar queda para el mejor fragmento de un manual en inglés, que compite en desventaja
  // contra decenas de fragmentos en español sobre lo mismo.
  const foreign = ranked.find((h) => h.es);
  if (foreign && k > 1 && !top.some((h) => h.es)) top.splice(k - 1, 1, foreign);
  return top;
}
