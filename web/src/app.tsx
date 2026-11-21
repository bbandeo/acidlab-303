import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { CodecError } from "./codec";
import {
  BankError,
  cloneBank,
  GATES,
  NOTES,
  OCTAVES,
  PATTERN_KEYS,
  type Bank,
  type Note,
  type PatternKey,
  type Step,
} from "./domain";
import { generate, SCALES, STYLES, type GenerateOptions, type ScaleId, type StyleId } from "./generator";
import { deliver, importFile, jsonFile, seqFiles } from "./io";
import { midiFlagEnabled, setMidiFlag } from "./midi";
import { MidiPanel } from "./midi-panel";
import { deleteBank, getPref, listBanks, saveBank, setPref } from "./storage";
import { AcidSynth } from "./synth";

const randomSeed = () => Math.floor(Math.random() * 100000);

function loadOpts(): GenerateOptions {
  try {
    const raw = getPref("gen");
    if (raw) return { ...JSON.parse(raw), seed: randomSeed() } as GenerateOptions;
  } catch {
    /* usa defaults */
  }
  return { tonic: "A", scale: "menor-natural", density: 0.7, style: "acid-techno", seed: randomSeed() };
}

function errText(e: unknown): string {
  if (e instanceof BankError) return e.errors.join("\n");
  if (e instanceof CodecError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

const gateLabel: Record<Step["gate"], string> = { on: "●", off: "·", tie: "—" };

export function App() {
  const [opts, setOpts] = useState<GenerateOptions>(loadOpts);
  const [bank, setBank] = useState<Bank>(() => generate(opts));
  const [key, setKey] = useState<PatternKey>("A");
  const [sel, setSel] = useState<number | null>(null);
  const [playStep, setPlayStep] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [bpm, setBpm] = useState(() => Number(getPref("bpm")) || 128);
  const [cutoff, setCutoff] = useState(500);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [saved, setSaved] = useState<Bank[]>(listBanks);
  const synth = useMemo(() => new AcidSynth(), []);
  const fileInput = useRef<HTMLInputElement>(null);

  const pattern = bank.patterns[key];
  synth.pattern = pattern;
  synth.bpm = bpm;
  synth.cutoff = cutoff;

  useEffect(() => {
    synth.onStep = setPlayStep;
    return () => synth.stop();
  }, [synth]);

  // Los avisos informativos se cierran solos; los errores quedan hasta tocarlos.
  useEffect(() => {
    if (!msg || msg.error) return;
    const t = setTimeout(() => setMsg(null), 3000);
    return () => clearTimeout(t);
  }, [msg]);

  const info = (text: string) => setMsg({ text });
  const fail = (e: unknown) => setMsg({ text: errText(e), error: true });

  function setOpt<K extends keyof GenerateOptions>(k: K, v: GenerateOptions[K]) {
    setOpts((o) => ({ ...o, [k]: v }));
  }

  function doGenerate(seed = opts.seed) {
    const o = { ...opts, seed };
    setOpts(o);
    setPref("gen", JSON.stringify({ ...o, seed: undefined }));
    setBank(generate(o));
    setSel(null);
    info(`Generado ${o.seed}`);
  }

  function updateBank(mut: (b: Bank) => void) {
    setBank((b) => {
      const next = cloneBank(b);
      mut(next);
      return next;
    });
  }

  function editStep(patch: Partial<Step>) {
    if (sel === null) return;
    updateBank((b) => Object.assign(b.patterns[key].steps[sel]!, patch));
  }

  async function togglePlay() {
    if (synth.playing) {
      synth.stop();
      setPlaying(false);
    } else {
      await synth.start();
      setPlaying(true);
    }
  }

  async function onImport(ev: Event) {
    const input = ev.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const r = await importFile(file);
      if (r.kind === "bank") {
        setBank(r.bank);
        info(`Banco "${r.bank.name}" importado`);
      } else {
        updateBank((b) => (b.patterns[key] = r.pattern));
        info(`${r.name} → patrón ${key} (firmware ${r.firmware})`);
      }
      setSel(null);
    } catch (e) {
      fail(e);
    }
  }

  async function exportFiles(kind: "seq" | "json") {
    const files = kind === "seq" ? seqFiles(bank) : [jsonFile(bank)];
    try {
      const how = await deliver(files, bank.name);
      if (how !== "cancelled") info(`${files.length} archivo(s) ${how === "shared" ? "compartido(s)" : "descargado(s)"}`);
    } catch (e) {
      fail(e);
    }
  }

  function save() {
    if (saveBank(bank)) {
      setSaved(listBanks());
      info(`Guardado "${bank.name}"`);
    } else fail(new Error("No se pudo guardar (almacenamiento del navegador lleno o bloqueado)"));
  }

  const step = sel !== null ? pattern.steps[sel] : undefined;

  return (
    <main>
      <header>
        <h1>TD-3 Acid</h1>
        <span class="muted">{bank.name}</span>
      </header>

      <section class="card">
        <h2>Generar</h2>
        <div class="row">
          <label>
            Tónica
            <select value={opts.tonic} onChange={(e) => setOpt("tonic", e.currentTarget.value as Note)}>
              {NOTES.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            Escala
            <select value={opts.scale} onChange={(e) => setOpt("scale", e.currentTarget.value as ScaleId)}>
              {Object.entries(SCALES).map(([id, s]) => (
                <option key={id} value={id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Estilo
            <select value={opts.style} onChange={(e) => setOpt("style", e.currentTarget.value as StyleId)}>
              {Object.entries(STYLES).map(([id, s]) => (
                <option key={id} value={id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label class="wide">
          Densidad {Math.round(opts.density * 100)}% ({Math.round(opts.density * 16)} pasos)
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={opts.density}
            onInput={(e) => setOpt("density", Number(e.currentTarget.value))}
          />
        </label>
        <div class="row">
          <label>
            Semilla
            <input
              type="number"
              inputMode="numeric"
              value={opts.seed}
              onInput={(e) => setOpt("seed", Math.max(0, Math.floor(Number(e.currentTarget.value) || 0)))}
            />
          </label>
          <button class="primary" onClick={() => doGenerate()}>
            Generar
          </button>
          <button onClick={() => doGenerate(randomSeed())} aria-label="Semilla al azar">
            🎲
          </button>
        </div>
      </section>

      <section class="card">
        <div class="tabs" role="tablist">
          {PATTERN_KEYS.map((k) => (
            <button key={k} role="tab" aria-selected={k === key} class={k === key ? "on" : ""} onClick={() => setKey(k)}>
              {k}
            </button>
          ))}
        </div>

        <div class="grid">
          {pattern.steps.map((s, i) => (
            <button
              key={i}
              class={[
                "cell",
                `g-${s.gate}`,
                i === sel ? "sel" : "",
                i === playStep ? "now" : "",
                i >= pattern.length ? "beyond" : "",
                i % 4 === 0 ? "beat" : "",
              ].join(" ")}
              onClick={() => setSel(i === sel ? null : i)}
              aria-label={`Paso ${i + 1}`}
            >
              <span class="num">{i + 1}</span>
              <span class="note">
                {s.gate === "on" ? s.note : gateLabel[s.gate]}
                {s.gate === "on" && s.octave !== 0 && <sup>{s.octave > 0 ? "+" : "−"}</sup>}
              </span>
              <span class="flags">
                {s.gate === "on" && s.accent && <b class="acc">A</b>}
                {s.gate === "on" && s.slide && <b class="sld">S</b>}
              </span>
            </button>
          ))}
        </div>

        {step && sel !== null && (
          <div class="editor">
            <div class="muted">Paso {sel + 1}</div>
            <div class="chips">
              {GATES.map((g) => (
                <button key={g} class={step.gate === g ? "on" : ""} onClick={() => editStep({ gate: g })}>
                  {g}
                </button>
              ))}
            </div>
            <div class="notes">
              {NOTES.map((n) => (
                <button
                  key={n}
                  class={[step.note === n ? "on" : "", n.includes("#") ? "sharp" : ""].join(" ")}
                  onClick={() => editStep({ note: n, gate: step.gate === "off" ? "on" : step.gate })}
                >
                  {n}
                </button>
              ))}
            </div>
            <div class="chips">
              {OCTAVES.map((o) => (
                <button key={o} class={step.octave === o ? "on" : ""} onClick={() => editStep({ octave: o })}>
                  {o > 0 ? "+1" : o < 0 ? "−1" : "0"}
                </button>
              ))}
              <button class={step.accent ? "on acc" : ""} onClick={() => editStep({ accent: !step.accent })}>
                Accent
              </button>
              <button class={step.slide ? "on sld" : ""} onClick={() => editStep({ slide: !step.slide })}>
                Slide
              </button>
            </div>
            {step.gate !== "on" && <div class="muted small">accent, slide y nota solo suenan en pasos "on".</div>}
          </div>
        )}

        <div class="row">
          <label>
            Largo
            <select
              value={pattern.length}
              onChange={(e) => updateBank((b) => (b.patterns[key].length = Number(e.currentTarget.value)))}
            >
              {Array.from({ length: 16 }, (_, i) => (
                <option key={i + 1}>{i + 1}</option>
              ))}
            </select>
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={pattern.triplet}
              onChange={(e) => updateBank((b) => (b.patterns[key].triplet = e.currentTarget.checked))}
            />
            Tresillo
          </label>
        </div>
      </section>

      <section class="card transport">
        <button class="primary play" onClick={togglePlay}>
          {playing ? "■ Stop" : "▶ Play"}
        </button>
        <label>
          BPM {bpm}
          <input
            type="range"
            min={80}
            max={160}
            value={bpm}
            onInput={(e) => {
              const v = Number(e.currentTarget.value);
              setBpm(v);
              setPref("bpm", String(v));
            }}
          />
        </label>
        <label>
          Cutoff
          <input
            type="range"
            min={150}
            max={2000}
            value={cutoff}
            onInput={(e) => setCutoff(Number(e.currentTarget.value))}
          />
        </label>
      </section>

      <section class="card">
        <h2>Archivo</h2>
        <div class="row wrap">
          <button onClick={save}>Guardar</button>
          <button onClick={() => exportFiles("seq")}>Exportar .seq ×4</button>
          <button onClick={() => exportFiles("json")}>Exportar .json</button>
          <button onClick={() => fileInput.current?.click()}>Importar…</button>
          <input ref={fileInput} type="file" accept=".seq,.json,application/json" hidden onChange={onImport} />
        </div>
        <p class="muted small">Los .seq se cargan en el TD-3 desde SynthTribe. Un .seq importado reemplaza el patrón {key}.</p>
        {saved.length > 0 && (
          <ul class="saved">
            {saved.map((b) => (
              <li key={b.name}>
                <button class="link" onClick={() => (setBank(b), setSel(null), info(`Abierto "${b.name}"`))}>
                  {b.name}
                </button>
                <button
                  class="small"
                  aria-label={`Borrar ${b.name}`}
                  onClick={() => {
                    if (confirm(`¿Borrar "${b.name}"?`)) {
                      deleteBank(b.name);
                      setSaved(listBanks());
                    }
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <MidiPanel pattern={pattern} patternKey={key} onMessage={info} onError={fail} />

      {!midiFlagEnabled() && (
        <footer>
          <button
            class="link small muted"
            onClick={() => {
              setMidiFlag(true);
              location.reload();
            }}
          >
            Activar envío MIDI USB (experimental)
          </button>
        </footer>
      )}

      {msg && (
        <div class={msg.error ? "toast error" : "toast"} role="status" onClick={() => setMsg(null)}>
          {msg.text}
        </div>
      )}
    </main>
  );
}
