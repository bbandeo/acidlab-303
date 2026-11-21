// Import/export de archivos: Web Share (Android → Drive, Telegram, etc.) con fallback a descarga.

import { decodeSeq, encodeSeq, seqFirmware } from "./codec";
import { bankToJson, parseBankText, PATTERN_KEYS, type Bank, type Pattern } from "./domain";

export function seqFiles(bank: Bank): File[] {
  return PATTERN_KEYS.map(
    (k) =>
      new File([encodeSeq(bank.patterns[k]) as BlobPart], `${bank.name}-${k}.seq`, {
        type: "application/octet-stream",
      }),
  );
}

export function jsonFile(bank: Bank): File {
  return new File([bankToJson(bank)], `${bank.name}.json`, { type: "application/json" });
}

function download(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Devuelve cómo se entregaron los archivos, para mostrarlo en la UI. */
export async function deliver(files: File[], title: string): Promise<"shared" | "downloaded" | "cancelled"> {
  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files, title });
      return "shared";
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return "cancelled";
      // Otro error (permiso, tipo no soportado): seguimos con la descarga.
    }
  }
  for (const f of files) download(f);
  return "downloaded";
}

export type Imported = { kind: "bank"; bank: Bank } | { kind: "pattern"; pattern: Pattern; firmware: string; name: string };

/** Lanza BankError o CodecError con mensaje legible si el archivo no sirve. */
export async function importFile(file: File): Promise<Imported> {
  if (file.name.toLowerCase().endsWith(".seq")) {
    const data = new Uint8Array(await file.arrayBuffer());
    return { kind: "pattern", pattern: decodeSeq(data), firmware: seqFirmware(data), name: file.name };
  }
  return { kind: "bank", bank: parseBankText(await file.text()) };
}
