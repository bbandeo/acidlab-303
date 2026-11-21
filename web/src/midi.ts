// EXPERIMENTAL (fase 5): envío del patrón al TD-3 por USB-OTG vía Web MIDI.
// El SysEx (codec.encodeSysex) NO está verificado en hardware: ver docs/FORMAT.md §SysEx.
// Solo se muestra en la UI con ?experimental=midi o el toggle de ajustes.

import { encodeSysex } from "./codec";
import type { Pattern } from "./domain";
import { getPref, setPref } from "./storage";

export function midiFlagEnabled(): boolean {
  const q = new URLSearchParams(location.search).get("experimental");
  return q === "midi" || getPref("experimental-midi") === "1";
}

export function setMidiFlag(on: boolean): void {
  setPref("experimental-midi", on ? "1" : "0");
}

export function midiSupported(): boolean {
  return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
}

export async function openMidi(): Promise<MIDIAccess> {
  return navigator.requestMIDIAccess({ sysex: true });
}

export function outputs(access: MIDIAccess): MIDIOutput[] {
  return [...access.outputs.values()];
}

/** group 0–3 (I–IV), slot 0–15. Devuelve los bytes enviados (para mostrarlos/depurar). */
export function sendPattern(out: MIDIOutput, pattern: Pattern, group: number, slot: number): Uint8Array {
  const bytes = encodeSysex(pattern, group, slot);
  out.send(bytes);
  return bytes;
}

export function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(" ");
}
