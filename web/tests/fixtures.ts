import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Raíz del paquete Python (tools/app-td-3): fixtures y schema se leen de ahí, sin copias.
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const TD3_BIN = join(ROOT, ".venv", "bin", "td3");
export const HAS_PY = existsSync(TD3_BIN);

export function bytes(rel: string): Uint8Array {
  return new Uint8Array(readFileSync(join(ROOT, rel)));
}

export function json(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf-8"));
}
