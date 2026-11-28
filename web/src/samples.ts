// Patrones de referencia de banks/samples/: van inlineados en el bundle, así funcionan sin conexión.

import manifest from "../../banks/samples/manifest.json";
import { decodeSeq, seqFirmware } from "./codec";
import type { Imported } from "./io";

const files = import.meta.glob<string>("../../banks/samples/*.seq", { query: "?url&inline", import: "default", eager: true });

function load(file: string, name: string): { imported: Extract<Imported, { kind: "pattern" }> } | { error: string } {
  try {
    const url = files[`../../banks/samples/${file}`];
    if (!url) throw new Error("archivo no encontrado");
    const data = Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (c) => c.charCodeAt(0));
    return { imported: { kind: "pattern", pattern: decodeSeq(data), firmware: seqFirmware(data), name } };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export const SAMPLES = [...manifest.sequences]
  .sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title) || (a.part ?? 0) - (b.part ?? 0))
  .map((s) => {
    const title = s.part === null ? s.title : `${s.title} (parte ${s.part})`;
    // La fuente distingue las dos transcripciones de un mismo tema.
    const detail = [s.artist, s.source_group, ...(s.confidence === "low" ? ["?"] : [])].join(" · ");
    return { file: s.file, title, detail, ...load(s.file, `${s.artist} – ${title}`) };
  });
