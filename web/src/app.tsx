import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { BankError, cloneBank, GATES, NOTES, OCTAVES, PATTERN_KEYS, type Bank, type Note, type PatternKey, type Step } from "./domain";
import { generate, SCALES, STYLES, type GenerateOptions, type ScaleId, type StyleId } from "./generator";
import { deliver, download, importFile, jsonFile, seqFiles, type Imported } from "./io";
import { Knob } from "./knob";
import { midiFlagEnabled, setMidiFlag } from "./midi";
import { MidiPanel } from "./midi-panel";
import { NumberInput } from "./number-input";
import { createProject, DEFAULT_GENERATOR, parseGenerator, parseProjectText, projectText, TONE_CONTROLS, type Project, type ToneKey } from "./project";
import { allowWrite, createExport, fileName, fingerprint, pickers, projectFile, writeExport, writeProject, type ExportBatch, type FileTarget, type Folder } from "./project-files";
import { getDrafts, getFolder, getSavedTarget, putFolder, putSaved, type Draft } from "./project-storage";
import { deleteBank, getPref, listBanks } from "./storage";
import { AcidSynth } from "./synth";
import { useProject } from "./use-project";
import { zipFiles } from "./zip";

const randomSeed = () => Math.floor(Math.random() * 100000);
const legacyBpm = () => Math.min(160, Math.max(80, Number(getPref("bpm")) || 128));

function loadOpts(): GenerateOptions {
  const seed = randomSeed();
  try {
    const raw = getPref("gen");
    if (raw) return parseGenerator({ ...JSON.parse(raw), seed });
  } catch {
    // Las preferencias antiguas pueden faltar o estar dañadas.
  }
  return { ...DEFAULT_GENERATOR, seed };
}

type OpenRequest = { project: Project; target: FileTarget | null; draft?: Draft };
type SeqImport = Extract<Imported, { kind: "pattern" }>;
const gateLabel: Record<Step["gate"], string> = { on: "●", off: "·", tie: "—" };
const gateName: Record<Step["gate"], string> = { on: "Sonido", off: "Silencio", tie: "Ligadura" };
const cancelled = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

export function App() {
  const session = useProject(() => createProject(loadOpts(), legacyBpm()));
  const { current, history, sessionId, dirty, recoverable, draftError, target, commit, move } = session;
  const { bank, generator: opts, bpm } = current;
  const [key, setKey] = useState<PatternKey>("A");
  const [sel, setSel] = useState<number | null>(null);
  const [playStep, setPlayStep] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [densityDraft, setDensityDraft] = useState<number | null>(null);
  const [gesture, setGesture] = useState<{ control: ToneKey; value: number } | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [drawer, setDrawer] = useState<"files" | "generator" | "midi" | null>(() => midiFlagEnabled() ? "midi" : null);
  const [folder, setFolder] = useState<Folder>();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const recoverableDrafts = drafts.filter((draft) => draft.session !== sessionId);
  const [showRecovery, setShowRecovery] = useState(true);
  const [legacy, setLegacy] = useState(listBanks);
  const [pendingSeq, setPendingSeq] = useState<SeqImport | null>(null);
  const [destination, setDestination] = useState<PatternKey>("A");
  const [pendingOpen, setPendingOpen] = useState<OpenRequest | null>(null);
  const [saveName, setSaveName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportBatch, setExportBatch] = useState<ExportBatch | null>(null);
  const synth = useMemo(() => new AcidSynth(), []);
  const canShareSeq = useMemo(() => navigator.canShare?.({
    files: [new File([""], "patron.seq", { type: "application/octet-stream" })],
  }), []);
  const fileInput = useRef<HTMLInputElement>(null);
  const latest = useRef({ current, dirty });
  latest.current = { current, dirty };

  const pattern = bank.patterns[key];
  const tone = useMemo(() => gesture ? previewTone(current, gesture.control, gesture.value) : current.tone,
    [current.tone, gesture]);
  const step = sel !== null ? pattern.steps[sel] : undefined;
  const undo = history.past.at(-1)?.label;
  const redo = history.future.at(-1)?.label;

  useEffect(() => {
    synth.onStep = setPlayStep;
    void getFolder().then(setFolder).catch(() => {});
    return () => synth.stop();
  }, [synth]);

  useLayoutEffect(() => {
    synth.pattern = pattern;
    synth.bpm = bpm;
    synth.setTone(tone);
  }, [pattern, bpm, tone, synth]);

  useEffect(() => {
    if (!showRecovery && drawer !== "files") return;
    let active = true;
    const refresh = () => { void getDrafts().then((items) => { if (active) setDrafts(items); }).catch(() => {}); };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, [drawer, showRecovery]);

  useEffect(() => {
    if (!msg || msg.error) return;
    const t = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(t);
  }, [msg]);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || gesture) return;
      const element = event.target;
      if (element instanceof HTMLElement && (element.matches("input, textarea, select") || element.isContentEditable)) return;
      const pressed = event.key.toLowerCase();
      if (pressed !== "z" && pressed !== "y") return;
      event.preventDefault();
      setGesture(null);
      move(pressed === "y" || event.shiftKey ? "redo" : "undo");
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  });

  const info = (text: string) => setMsg({ text });
  const fail = (e: unknown) => {
    if (!cancelled(e)) setMsg({ text: e instanceof BankError ? e.errors.join("\n") : e instanceof Error ? e.message : String(e), error: true });
  };

  function setOpt<K extends keyof GenerateOptions>(k: K, v: GenerateOptions[K]) {
    commit((p) => ({ ...p, generator: { ...p.generator, [k]: v } }), "ajuste del generador");
  }

  function doGenerate(seed = opts.seed) {
    const generator = { ...opts, seed };
    commit((p) => ({ ...p, generator, bank: generate(generator) }), "generación");
    info(`Generado · semilla ${seed}`);
  }

  function updateBank(mut: (b: Bank) => void, label = "edición de patrón") {
    commit((p) => {
      const next = cloneBank(p.bank);
      mut(next);
      return { ...p, bank: next };
    }, label);
  }

  function editStep(patch: Partial<Step>) {
    if (sel !== null) updateBank((b) => Object.assign(b.patterns[key].steps[sel]!, patch), `edición del paso ${sel + 1}`);
  }

  function previewTone(project: Project, control: ToneKey, value: number): Project["tone"] {
    if (project.tone[control] === value) return project.tone;
    const tone = { ...project.tone, [control]: value };
    if (control === "accent") delete tone.legacySlideAccent;
    return tone;
  }

  function changeTone(control: ToneKey, value: number) {
    setGesture(null);
    commit((p) => ({ ...p, tone: previewTone(p, control, value) }), `cambio de ${TONE_CONTROLS[control].label.toLowerCase()}`);
  }

  async function togglePlay() {
    try {
      if (synth.playing) synth.stop();
      else await synth.start();
      setPlaying(synth.playing);
    } catch (e) {
      fail(e);
    }
  }

  async function openNow(request: OpenRequest) {
    try {
      const original = latest.current.current;
      if (!await session.open(request.project, request.target, () => latest.current.current === original, request.draft)) {
        setPendingOpen(request);
        return;
      }
      setKey("A");
      setSel(null);
      setGesture(null);
      setDensityDraft(null);
      setPendingOpen(null);
      setPendingSeq(null);
      setSaveName(null);
      setShowRecovery(false);
      info(`Abierto «${request.project.bank.name}»`);
    } catch (e) {
      fail(e);
    }
  }

  function requestOpen(request: OpenRequest) {
    if (latest.current.dirty) {
      setPendingOpen(request);
      requestAnimationFrame(() => document.getElementById("pending-open")?.scrollIntoView({ block: "nearest" }));
    }
    else void openNow(request);
  }

  async function readProject(file: File, handle?: FileTarget["file"]) {
    const text = await file.text();
    const { project, migrated } = parseProjectText(text, loadOpts(), legacyBpm());
    let fileTarget: FileTarget | null = null;
    if (handle && !migrated) {
      fileTarget = { name: handle.name, file: handle, fingerprint: await fingerprint(file) };
      const remembered = await getSavedTarget(project.id, handle).catch(() => undefined);
      if (remembered?.folder) fileTarget.folder = remembered.folder;
    }
    requestOpen({ project, target: fileTarget });
  }

  async function chooseProject() {
    if (!pickers.showOpenFilePicker) return fileInput.current?.click();
    try {
      const [handle] = await pickers.showOpenFilePicker({
        types: [{ description: "Proyecto o banco JSON", accept: { "application/json": [".json"] } }],
      });
      if (handle) await readProject(await handle.getFile(), handle);
    } catch (e) {
      if (e instanceof DOMException && e.name === "SecurityError") fileInput.current?.click();
      else fail(e);
    }
  }

  async function onImport(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      if (!file.name.toLowerCase().endsWith(".seq")) return await readProject(file);
      const imported = await importFile(file);
      if (imported.kind === "pattern") {
        setPendingSeq(imported);
        setDestination("A");
      }
    } catch (e) {
      fail(e);
    }
  }

  async function chooseFolder() {
    try {
      if (!pickers.showDirectoryPicker) throw new Error("Selector de carpetas no disponible. Podés descargar una copia.");
      const selected = await pickers.showDirectoryPicker({ mode: "readwrite" });
      setFolder(selected);
      await putFolder(selected).catch(() => info("Carpeta disponible durante esta sesión"));
    } catch (e) {
      fail(e);
    }
  }

  async function save(asName?: string) {
    if (busy) return;
    if (!target && asName === undefined) {
      showDrawer("files");
      setSaveName(`${bank.name}.acidlab.json`);
      return;
    }
    setBusy(true);
    const snapshot = current;
    try {
      const previous = asName === undefined ? target : null;
      const name = previous?.name ?? fileName(asName ?? "");
      const writable = previous?.file ?? folder;
      if (!writable) throw new Error("Elegí una carpeta o descargá el proyecto");
      await allowWrite(writable);
      const result = await writeProject(folder, name, snapshot, previous);
      session.markSaved(snapshot, result);
      setSaveName(null);
      const place = result.folder?.name ?? result.name;
      info(`Guardado en ${place}`);
      try {
        await putSaved(snapshot, result, sessionId);
      } catch {
        info(`Guardado en ${place}. El destino quedó disponible en esta sesión.`);
      }
      if (pendingOpen && projectText(latest.current.current) === projectText(snapshot)) await openNow(pendingOpen);
    } catch (e) {
      showDrawer("files");
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function exportPatterns(retry = false) {
    if (busy) return;
    setBusy(true);
    const batch = retry && exportBatch ? exportBatch : createExport(seqFiles(current.bank));
    try {
      if (!folder) throw new Error("Elegí una carpeta o descargá el ZIP");
      await allowWrite(retry && exportBatch?.directory ? exportBatch.directory as Folder : folder);
      await writeExport(folder, batch);
      setExportBatch(null);
      info(`4 de 4 archivos escritos en ${batch.name}`);
    } catch (e) {
      if (!cancelled(e)) setExportBatch({ ...batch });
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function sharePatterns() {
    try {
      const result = await deliver(seqFiles(bank), bank.name);
      if (result !== "cancelled") info(result === "shared" ? "4 patrones compartidos" : "Descarga iniciada");
    } catch (e) {
      fail(e);
    }
  }

  async function downloadZip() {
    try {
      download(await zipFiles(seqFiles(bank), `${bank.name}-patrones.zip`));
      info("Descarga iniciada");
    } catch (e) {
      fail(e);
    }
  }

  function showDrawer(name: NonNullable<typeof drawer>) {
    setDrawer(name);
    requestAnimationFrame(() => document.getElementById(name)?.scrollIntoView({ block: "nearest" }));
  }

  function toggleDrawer(name: NonNullable<typeof drawer>) {
    if (drawer === name) setDrawer(null);
    else showDrawer(name);
  }

  const displayStatus = dirty
    ? recoverable ? "Borrador local" : draftError ? "Cambios sin guardar · borrador no disponible" : "Cambios sin guardar"
    : target ? `Guardado en ${target.folder?.name ?? target.name}` : "Sesión abierta";

  return (
    <main class="instrument">
      <header class="instrument-header">
        <div class="brand"><h1>ACIDLAB <span>303</span></h1><p>BASS LINE SEQUENCER</p></div>
        <div class="display">
          <strong>{bank.name}</strong>
          <div class="display-meta">
            <label>BPM <NumberInput label="BPM" min={80} max={160} value={bpm}
              commit={(value) => commit((p) => ({ ...p, bpm: value }), "tempo")} />
            </label>
            <span>Patrón {key}</span><span aria-live="polite">{displayStatus}</span>
          </div>
        </div>
        <div class="transport" aria-label="Transporte y memoria">
          <button class="primary play" onClick={() => void togglePlay()}>{playing ? "■ Stop" : "▶ Play"}</button>
          <button disabled={busy} onClick={() => void save()}>Guardar</button>
          <button disabled={!undo || !!gesture} aria-label={undo ? `Deshacer ${undo}` : "Deshacer"} title={undo}
            onClick={() => { setGesture(null); move("undo"); }}>Deshacer</button>
          <button disabled={!redo || !!gesture} aria-label={redo ? `Rehacer ${redo}` : "Rehacer"} title={redo}
            onClick={() => { setGesture(null); move("redo"); }}>Rehacer</button>
        </div>
        <button class="file-button" aria-expanded={drawer === "files"} aria-controls="files" onClick={() => toggleDrawer("files")}>Archivo</button>
      </header>

      <section class="tone-section" aria-labelledby="tone-title">
        <div class="section-line"><h2 id="tone-title">Timbre</h2><span class="muted mono">Escucha web</span></div>
        <div class="knobs">
          {(Object.keys(TONE_CONTROLS) as ToneKey[]).map((control) => (
            <Knob key={control} control={control} value={tone[control]}
              preview={(value) => setGesture({ control, value })}
              cancel={() => setGesture(null)} commit={(value) => changeTone(control, value)} />
          ))}
        </div>
      </section>

      <section class="sequencer" aria-label="Secuenciador">
        <div class="sequence-tools">
          <div class="patterns">
            <h2>Patrón</h2>
            <div class="tabs" role="tablist" aria-label="Variantes">
              {PATTERN_KEYS.map((k, i) => (
                <button key={k} id={`tab-${k}`} role="tab" aria-controls="pattern-steps" aria-selected={k === key} tabIndex={k === key ? 0 : -1} class={k === key ? "on" : ""}
                  onClick={() => setKey(k)} onKeyDown={(e) => {
                    const positions: Record<string, number> = {
                      ArrowRight: (i + 1) % 4, ArrowLeft: (i + 3) % 4, Home: 0, End: 3,
                    };
                    if (!Object.hasOwn(positions, e.key)) return;
                    e.preventDefault();
                    const index = positions[e.key]!;
                    setKey(PATTERN_KEYS[index]!);
                    (e.currentTarget.parentElement?.children[index] as HTMLButtonElement | undefined)?.focus();
                  }}>{k}</button>
              ))}
            </div>
          </div>
          <label class="compact">Largo
            <select value={pattern.length} onChange={(e) => updateBank((b) => { b.patterns[key].length = Number(e.currentTarget.value); }, "largo del patrón")}>
              {Array.from({ length: 16 }, (_, i) => <option key={i + 1}>{i + 1}</option>)}
            </select>
          </label>
          <label class="check"><input type="checkbox" checked={pattern.triplet}
            onChange={(e) => updateBank((b) => { b.patterns[key].triplet = e.currentTarget.checked; }, "tresillo")} /> Tresillo</label>
          <button class={tone.driveEnabled ? "on fx" : "fx"} aria-pressed={tone.driveEnabled}
            onClick={() => commit((p) => ({ ...p, tone: { ...p.tone, driveEnabled: !p.tone.driveEnabled } }), "bypass de Drive")}>
            FX {tone.driveEnabled ? "ON" : "OFF"}
          </button>
          <div class="drawer-buttons">
            <button aria-expanded={drawer === "generator"} aria-controls="generator" onClick={() => toggleDrawer("generator")}>Generador</button>
            <button aria-expanded={drawer === "midi"} aria-controls="midi" onClick={() => {
              if (drawer !== "midi") setMidiFlag(true);
              toggleDrawer("midi");
            }}>MIDI</button>
          </div>
        </div>

        <div class="grid" id="pattern-steps" role="tabpanel" aria-labelledby={`tab-${key}`}>
          {Array.from({ length: 4 }, (_, group) => (
            <div class="beat-group" key={group}>
              {pattern.steps.slice(group * 4, group * 4 + 4).map((s, j) => {
                const i = group * 4 + j;
                return (
                  <button key={i}
                    class={`cell g-${s.gate} ${i === sel ? "sel" : ""} ${i === playStep ? "now" : ""} ${i >= pattern.length ? "beyond" : ""}`}
                    onClick={() => setSel(i === sel ? null : i)}
                    aria-pressed={i === sel} aria-label={`Paso ${i + 1}`}
                    aria-description={`${s.gate === "on" ? `${s.note}, octava ${s.octave}${s.accent ? ", acento" : ""}${s.slide ? ", slide" : ""}` : gateName[s.gate]}${i >= pattern.length ? ", fuera del largo" : ""}`}>
                    <span class="num">{String(i + 1).padStart(2, "0")}</span>
                    <span class="note">{s.gate === "on" ? s.note : gateLabel[s.gate]}
                      {s.gate === "on" && s.octave !== 0 && <sup>{s.octave > 0 ? "+" : "−"}</sup>}
                    </span>
                    <span class="flags" aria-hidden="true">
                      {s.gate === "on" && s.accent && <b class="acc">●</b>}
                      {s.gate === "on" && s.slide && <b class="sld" />}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div class="legend mono"><span>● Acento</span><span>→ Slide</span><span>— Ligadura</span><span>· Silencio</span></div>
        <div class="editor" aria-label="Inspector de pasos">
        {step && sel !== null ? (<>
            <div class="inspector-title">Paso {sel + 1}</div>
            <div class="chips">
              {GATES.map((g) => (
                <button key={g} aria-pressed={step.gate === g} class={step.gate === g ? "on" : ""} onClick={() => editStep({ gate: g })}>
                  {gateName[g]}
                </button>
              ))}
            </div>
            <div class="notes">
              {NOTES.map((n) => (
                <button
                  key={n}
                  aria-pressed={step.note === n}
                  class={[step.note === n ? "on" : "", n.includes("#") ? "sharp" : ""].join(" ")}
                  onClick={() => editStep({ note: n, gate: step.gate === "off" ? "on" : step.gate })}
                >
                  {n}
                </button>
              ))}
            </div>
            <div class="chips">
              {OCTAVES.map((o) => (
                <button key={o} aria-label={`Octava ${o}`} aria-pressed={step.octave === o} class={step.octave === o ? "on" : ""} onClick={() => editStep({ octave: o })}>
                  {o > 0 ? "+1" : o < 0 ? "−1" : "0"}
                </button>
              ))}
              <button aria-pressed={step.accent} class={step.accent ? "on acc" : ""} onClick={() => editStep({ accent: !step.accent })}>
                Accent
              </button>
              <button aria-pressed={step.slide} class={step.slide ? "on sld" : ""} onClick={() => editStep({ slide: !step.slide })}>
                Slide
              </button>
            </div>
        </>) : <p>Seleccioná un paso para editarlo.</p>}
        </div>


      </section>

      {drawer === "generator" && <section class="card drawer" id="generator">
        <h2>Generador</h2>
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
          Densidad {Math.round((densityDraft ?? opts.density) * 100)}% ({Math.round((densityDraft ?? opts.density) * 16)} pasos)
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={densityDraft ?? opts.density}
            onInput={(e) => setDensityDraft(e.currentTarget.valueAsNumber)}
            onChange={(e) => {
              setOpt("density", e.currentTarget.valueAsNumber);
              setDensityDraft(null);
            }}
          />
        </label>
        <div class="row">
          <label>
            Semilla
            <NumberInput label="Semilla" min={0} max={0xffffffff} value={opts.seed} commit={(value) => setOpt("seed", value)} />
          </label>
          <button class="primary" onClick={() => doGenerate()}>
            Generar
          </button>
          <button onClick={() => doGenerate(randomSeed())} aria-label="Semilla al azar">
            Al azar
          </button>
        </div>

      </section>}

      <input ref={fileInput} type="file" accept=".seq,.json,application/json" hidden onChange={(e) => void onImport(e.currentTarget)} />
      {drawer === "files" && <section class="card drawer" id="files">
        <h2>Archivo</h2>
        <div class="file-line">
          <span>Carpeta de trabajo<br /><strong>{folder?.name ?? "Sin carpeta"}</strong></span>
          <button disabled={!pickers.showDirectoryPicker || busy} onClick={() => void chooseFolder()}>Elegir carpeta</button>
        </div>
        <div class="file-line">
          <span>Proyecto<br /><strong>{target?.name ?? `${bank.name}.acidlab.json`}</strong></span>
          <div class="row wrap">
            <button disabled={busy} onClick={() => void chooseProject()}>Abrir proyecto</button>
            <button disabled={busy} onClick={() => setSaveName(`${bank.name}.acidlab.json`)}>Guardar como</button>
            <button onClick={() => { download(projectFile(current)); info("Descarga iniciada"); }}>Descargar proyecto</button>
          </div>
        </div>
        {saveName !== null && <form class="row wrap save-as" onSubmit={(e) => { e.preventDefault(); void save(saveName); }}>
          <label>Nombre de archivo<input type="text" required maxLength={100} value={saveName} onInput={(e) => setSaveName(e.currentTarget.value)} /></label>
          <button class="primary" disabled={busy || !folder} type="submit">Guardar en carpeta</button>
          <button type="button" onClick={() => setSaveName(null)}>Cancelar nombre</button>
        </form>}
        <div class="file-line">
          <span>Patrones A–D<br /><small>.seq para SynthTribe</small></span>
          <div class="row wrap">
            <button disabled={busy} onClick={() => fileInput.current?.click()}>Importar .seq</button>
            <button disabled={!folder || busy} onClick={() => void exportPatterns()}>Exportar A–D</button>
            <button onClick={() => void downloadZip()}>Descargar ZIP</button>
            {canShareSeq &&
              <button onClick={() => void sharePatterns()}>Compartir .seq</button>}
            <button onClick={() => { download(jsonFile(bank)); info("Descarga iniciada"); }}>Descargar banco JSON</button>
          </div>
        </div>
        {exportBatch && <div class="row wrap">
          <span role="status">{exportBatch.written} de 4 escritos{exportBatch.written > 0 ? ` · ${exportBatch.files.slice(0, exportBatch.written).map((f) => f.name).join(", ")}` : ""}</span>
          <button disabled={!folder || busy} onClick={() => void exportPatterns(true)}>Reintentar pendientes</button>
        </div>}
        {legacy.length > 0 && <details><summary>Bancos locales anteriores</summary>
          {legacy.map((b) => <div class="file-line" key={b.name}>
            <button onClick={() => requestOpen({ project: parseProjectText(JSON.stringify(b), loadOpts(), legacyBpm()).project, target: null })}>{b.name}</button>
            <button aria-label={`Borrar ${b.name}`} onClick={() => {
              if (!confirm(`¿Borrar «${b.name}» de los bancos locales anteriores?`)) return;
              if (deleteBank(b.name)) setLegacy(listBanks());
              else fail(new Error("No se pudo borrar el banco local"));
            }}>Borrar</button>
          </div>)}
        </details>}
        {recoverableDrafts.length > 0 && <button onClick={() => setShowRecovery(true)}>Ver borradores locales</button>}
      </section>}

      <div id="midi" hidden={drawer !== "midi"}>
        <MidiPanel pattern={pattern} patternKey={key} onMessage={info} onError={fail} onClose={() => { setMidiFlag(false); setDrawer(null); }} />
      </div>

      {pendingSeq && <section class="card drawer" aria-label="Importar patrón">
        <h2>Importar patrón</h2>
        <p>{pendingSeq.name} · Firmware {pendingSeq.firmware}</p>
        <div class="row wrap">
          <label>Patrón de destino<select value={destination} onChange={(e) => setDestination(e.currentTarget.value as PatternKey)}>
            {PATTERN_KEYS.map((k) => <option key={k}>{k}</option>)}
          </select></label>
          <button class="primary" onClick={() => {
            updateBank((b) => { b.patterns[destination] = pendingSeq.pattern; }, `importación del patrón ${destination}`);
            setKey(destination);
            setPendingSeq(null);
          }}>Confirmar importación</button>
          <button onClick={() => setPendingSeq(null)}>Cancelar importación</button>
        </div>
      </section>}

      {pendingOpen && <section class="card drawer" id="pending-open" aria-label="Ediciones pendientes">
        <h2>Ediciones pendientes</h2>
        <p>Guardá esta sesión antes de abrir «{pendingOpen.project.bank.name}» o seguí editando.</p>
        <div class="row wrap">
          <button class="primary" disabled={busy} onClick={() => void save()}>Guardar y abrir</button>
          <button disabled={busy} onClick={() => void openNow(pendingOpen)}>Abrir y conservar borrador</button>
          <button disabled={busy} onClick={() => setPendingOpen(null)}>Seguir editando</button>
        </div>
      </section>}

      {showRecovery && recoverableDrafts.length > 0 && <section class="card drawer" aria-label="Borradores recuperables">
        <h2>Borradores recuperables</h2>
        {recoverableDrafts.map((draft) => <div class="file-line" key={`${draft.project.id}/${draft.session}`}>
          <div>{draft.project.bank.name}<br /><small>{new Date(draft.updated).toLocaleString()}</small></div>
          <div class="row wrap">
            <button disabled={busy} onClick={() => requestOpen({ project: draft.project, target: null, draft })}>Recuperar</button>
          </div>
        </div>)}
        <button onClick={() => setShowRecovery(false)}>Ahora no</button>
      </section>}

      {msg && <div class={msg.error ? "toast error" : "toast"} role="status">
        <span>{msg.text}</span><button aria-label="Cerrar aviso" onClick={() => setMsg(null)}>×</button>
      </div>}
    </main>
  );
}
