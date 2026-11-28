import { describe, expect, it } from "vitest";
import { MANUALS } from "../src/guides";
import index from "../src/manual-index.json";
import { search, tokenize } from "../src/manual-search";

describe("manual-search", () => {
  it("normaliza acentos, quita palabras vacías y recorta a 5 letras", () => {
    expect(tokenize("¿Cómo cambio la Sincronización?")).toEqual(["cambi", "sincr"]);
  });

  it("ordena primero el fragmento más relevante", () => {
    const chunks = ["el tempo ajusta la velocidad", "el filtro tiene resonancia", "velocidad del tempo y tempo"].map(
      (text, i) => ({ manual: "m", file: "m.pdf", page: i + 1, text }),
    );
    expect(search(chunks, "tempo").map((h) => h.page)).toEqual([3, 1]);
  });

  it("devuelve vacío sin términos útiles o sin coincidencias", () => {
    expect(search(index, "")).toEqual([]);
    expect(search(index, "¿y de la?")).toEqual([]);
    expect(search(index, "xyzzy")).toEqual([]);
  });

  it("busca en el índice generado, sin las páginas de ruido", () => {
    expect(search(index, "afinar el oscilador 220 Hz")[0]?.page).toBe(8);
    expect(index.some((c) => c.file.includes("Espanol") && [1, 2, 3, 4, 5, 6, 9, 15].includes(c.page))).toBe(false);
    expect(index.every((c) => c.text.length >= 60)).toBe(true);
  });

  it("reserva el último lugar para el mejor fragmento traducido", () => {
    const base = { manual: "m", file: "m.pdf" };
    const chunks = [
      ...[1, 2, 3].map((page) => ({ ...base, page, text: "silencio silencio en el patrón" })),
      { ...base, page: 4, text: "set rests", es: "definir un silencio entre muchas otras palabras de relleno" },
    ];
    expect(search(chunks, "silencio").map((h) => h.page)).toEqual([1, 2, 4]);
  });

  it("indexa traducidos todos los fragmentos en inglés", () => {
    const english = index.filter((c) => c.file.includes("Pattern") || (c.file.includes("Espanol") && c.page === 14));
    expect(english.length).toBeGreaterThan(0);
    expect(english.every((c) => "es" in c)).toBe(true);
    expect(search(index, "silencio en time mode").some((c) => c.file.includes("Pattern"))).toBe(true);
  });

  it("cada fragmento apunta a un manual publicado en GUÍAS", () => {
    const published = new Set(MANUALS.map((m) => m.file));
    expect([...new Set(index.map((c) => c.file))].filter((f) => !published.has(f))).toEqual([]);
  });
});
