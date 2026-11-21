// Bancos guardados en el navegador. localStorage puede fallar (modo privado, cuota): todo va en try/catch.

import { parseBank, type Bank } from "./domain";

const KEY = "td3.banks.v1";

function readAll(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(KEY);
    const data: unknown = raw ? JSON.parse(raw) : {};
    return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, unknown>): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** Bancos válidos, ordenados por nombre. Los corruptos se ignoran. */
export function listBanks(): Bank[] {
  return Object.values(readAll())
    .flatMap((v) => {
      try {
        return [parseBank(v)];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function saveBank(bank: Bank): boolean {
  return writeAll({ ...readAll(), [bank.name]: bank });
}

export function deleteBank(name: string): boolean {
  const all = readAll();
  delete all[name];
  return writeAll(all);
}

export function getPref(key: string): string | null {
  try {
    return localStorage.getItem(`td3.pref.${key}`);
  } catch {
    return null;
  }
}

export function setPref(key: string, value: string): void {
  try {
    localStorage.setItem(`td3.pref.${key}`, value);
  } catch {
    /* preferencia no persistida: no es crítico */
  }
}
