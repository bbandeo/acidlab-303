import { useState } from "preact/hooks";
import type { Pattern, PatternKey } from "./domain";
import { hex, midiSupported, openMidi, outputs, sendPattern } from "./midi";
import { ActionRow, MenuNote, PrimaryButton, ValueRow } from "./panel/menu";

interface Props {
  pattern: Pattern;
  patternKey: PatternKey;
  onMessage: (t: string) => void;
  onError: (e: unknown) => void;
}

export function MidiPanel({ pattern, patternKey, onMessage, onError }: Props) {
  const [outs, setOuts] = useState<MIDIOutput[]>([]);
  const [outId, setOutId] = useState("");
  const [group, setGroup] = useState(0);
  const [slot, setSlot] = useState(0);
  const [last, setLast] = useState("");

  async function connect() {
    try {
      const access = await openMidi();
      const list = outputs(access);
      setOuts(list);
      const td3 = list.find((o) => /td-?3/i.test(o.name ?? "")) ?? list[0];
      setOutId(td3?.id ?? "");
      onMessage(list.length ? `${list.length} salida(s) MIDI` : "No hay salidas MIDI (¿cable OTG conectado?)");
    } catch (e) {
      onError(e);
    }
  }

  function send() {
    const out = outs.find((o) => o.id === outId);
    if (!out) return onError(new Error("Elegí una salida MIDI"));
    if (!confirm(`SysEx SIN VERIFICAR. ¿Escribir el patrón ${patternKey} en el grupo ${group + 1}, slot ${slot + 1} del TD-3?`)) {
      return;
    }
    try {
      setLast(hex(sendPattern(out, pattern, group, slot)));
      onMessage(`Enviado a ${out.name ?? out.id}`);
    } catch (e) {
      onError(e);
    }
  }

  const current = outs.find((o) => o.id === outId);

  return (
    <div class="m-fill">
      <MenuNote warn>SysEx experimental, no verificado en un TD-3 real. Puede no funcionar o escribir en otro slot. Hacé backup en SynthTribe antes de enviar.</MenuNote>
      {!midiSupported() ? (
        <MenuNote>Este navegador no soporta Web MIDI (usá Chrome en Android).</MenuNote>
      ) : (<>
        <div class="m-list">
          {outs.length === 0
            ? <ActionRow label="Conectar" sub="Buscar salidas MIDI USB" onClick={() => void connect()} />
            : <label class="m-row">
              <span class="m-row-label">PUERTO</span>
              <select class="m-select" value={outId} onChange={(e) => setOutId(e.currentTarget.value)}>
                {outs.map((o) => <option key={o.id} value={o.id}>{o.name ?? o.id}</option>)}
              </select>
            </label>}
          <ValueRow label="GRUPO" value={String(group + 1)} plain
            onClick={() => setGroup((group + 1) % 4)} onPrev={() => setGroup((group + 3) % 4)} />
          <ValueRow label="SLOT" value={String(slot + 1)} plain
            onClick={() => setSlot((slot + 1) % 16)} onPrev={() => setSlot((slot + 15) % 16)} />
        </div>
        {last && <pre class="m-hex">{last}</pre>}
        <div class="m-spacer" />
        <PrimaryButton disabled={!current} onClick={send}>ENVIAR PATRÓN {patternKey}</PrimaryButton>
      </>)}
    </div>
  );
}
