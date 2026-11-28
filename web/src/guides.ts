// Manuales y guías de docs/guides/: Vite los emite como assets; se abren con el visor de PDF del navegador.
// ponytail: título derivado del nombre de archivo; agregar un manifest si hace falta autor/descripción.

const files = import.meta.glob<string>("../../docs/guides/*.pdf", { query: "?url", import: "default", eager: true });

export const GUIDES = Object.entries(files)
  .map(([path, url]) => ({ url, title: path.slice(path.lastIndexOf("/") + 1, -4).replace(/_/g, " ") }))
  .sort((a, b) => a.title.localeCompare(b.title));
