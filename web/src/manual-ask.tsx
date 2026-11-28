// Caja de pregunta de GUÍAS: muestra los fragmentos de los manuales más relevantes (búsqueda local, sin modelo).
import { useState } from "preact/hooks";
import { MANUALS } from "./guides";
import type { Hit } from "./manual-search";
import { ActionRow, MenuNote, PrimaryButton } from "./panel/menu";

export function ManualAsk() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [failed, setFailed] = useState(false);

  async function ask(e: Event) {
    e.preventDefault();
    if (!query.trim()) return setHits(null);
    try {
      // Carga diferida: el índice queda fuera del bundle principal (el SW lo precachea igual).
      const [{ search }, { default: index }] = await Promise.all([import("./manual-search"), import("./manual-index.json")]);
      setHits(search(index, query));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  return (
    <div class="m-file-group">
      <h2 class="m-group-title">Buscar en los manuales</h2>
      <form class="m-form" role="search" onSubmit={(e) => void ask(e)}>
        <label class="m-field">PREGUNTA SOBRE EL TD-3
          <input type="search" enterKeyHint="search" placeholder="¿Cómo borro un patrón?" value={query}
            onInput={(e) => setQuery(e.currentTarget.value)} />
        </label>
        <PrimaryButton type="submit">BUSCAR</PrimaryButton>
      </form>
      <div class="m-list m-hits" aria-live="polite">
        {failed && <MenuNote warn>No se pudo cargar el índice de los manuales. Recargá la app e intentá de nuevo.</MenuNote>}
        {hits?.length === 0 && <MenuNote>No encontré nada en los manuales. Probá con otras palabras.</MenuNote>}
        {hits?.map((h) => {
          const manual = MANUALS.find((m) => m.file === h.file);
          return manual && <ActionRow key={h.text} label={`${manual.title} · p. ${h.page}`}
            sub={h.es ? `Traducido del inglés: ${h.es}` : h.text}
            onClick={() => window.open(`${manual.url}#page=${h.page}`, "_blank", "noopener")} />;
        })}
        {!!hits?.length && <MenuNote>Son fragmentos de los manuales, no una respuesta generada. Tocá uno para abrir esa página.</MenuNote>}
      </div>
    </div>
  );
}
