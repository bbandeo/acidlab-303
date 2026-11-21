import { useState } from "preact/hooks";
import type { Pattern, PatternKey } from "./domain";
import { hex, midiFlagEnabled, midiSupported, openMidi, outputs, sendPattern, setMidiFlag } from "./midi";

interface Props {
  pattern: Pattern;
  patternKey: PatternKey;
  onMessage: (t: string) => void;
  onError: (e: unknown) => void;
}

/** Panel experimental: invisible salvo con ?experimental=midi o el toggle guardado. */
export function MidiPanel({ pattern, patternKey, onMessage, onError }: Props) {
  const [enabled, setEnabled] = useState(midiFlagEnabled);
  const [outs, setOuts] = useState<MIDIOutput[]>([]);
  const [outId, setOutId] = useState("");
  const [group, setGroup] = useState(0);
  const [slot, setSlot] = useState(0);
  const [last, setLast] = useState("");

  if (!enabled) return null;

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

  return (
    <section class="card experimental">
      <h2>MIDI USB (experimental)</h2>
      <p class="warn">
        El SysEx no está verificado en un TD-3 real. Puede no funcionar o escribir en otro slot. Hacé backup en SynthTribe antes.
      </p>
      {!midiSupported() ? (
        <p class="muted">Este navegador no soporta Web MIDI (usá Chrome en Android).</p>
      ) : (
        <>
          <div class="row wrap">
            <button onClick={connect}>Conectar</button>
            <select value={outId} onChange={(e) => setOutId(e.currentTarget.value)} disabled={!outs.length}>
              {outs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name ?? o.id}
                </option>
              ))}
            </select>
          </div>
          <div class="row">
            <label>
              Grupo
              <select value={group} onChange={(e) => setGroup(Number(e.currentTarget.value))}>
                {[0, 1, 2, 3].map((g) => (
                  <option key={g} value={g}>
                    {g + 1}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Slot
              <select value={slot} onChange={(e) => setSlot(Number(e.currentTarget.value))}>
                {Array.from({ length: 16 }, (_, s) => (
                  <option key={s} value={s}>
                    {s + 1}
                  </option>
                ))}
              </select>
            </label>
            <button class="primary" onClick={send} disabled={!outId}>
              Enviar {patternKey}
            </button>
          </div>
          {last && <pre class="hex">{last}</pre>}
        </>
      )}
      <button
        class="link small"
        onClick={() => {
          setMidiFlag(false);
          setEnabled(false);
        }}
      >
        Ocultar panel MIDI
      </button>
    </section>
  );
}
