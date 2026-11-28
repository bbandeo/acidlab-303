// Manuales (PDF) y hojas de patrón (imágenes) de docs/guides/: Vite los emite como assets y el SW los precachea.
// ponytail: título derivado del nombre de archivo; agregar un manifest si hace falta autor/descripción.

const files = import.meta.glob<string>("../../docs/guides/*.{pdf,jpg,jpeg,png}", { query: "?url", import: "default", eager: true });

const all = Object.entries(files)
  .map(([path, url]) => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    return { url, pdf: name.endsWith(".pdf"), title: name.slice(0, name.lastIndexOf(".")).replace(/_/g, " ") };
  })
  .sort((a, b) => a.title.localeCompare(b.title));

export const MANUALS = all.filter((g) => g.pdf);
export const SHEETS = all.filter((g) => !g.pdf);
