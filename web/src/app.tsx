import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { BankError, cloneBank, NOTES, PATTERN_KEYS, type Bank, type Note, type Pattern, type PatternKey, type Step } from "./domain";
import { generate, SCALES, STYLES, type GenerateOptions, type ScaleId, type StyleId } from "./generator";
import { deliver, download, importFile, jsonFile, seqFiles, type Imported } from "./io";
import { MidiPanel } from "./midi-panel";
import { createProject, DEFAULT_GENERATOR, DEFAULT_TONE, parseGenerator, parseProjectText, projectText, TONE_CONTROLS, type Project, type ToneKey } from "./project";
import { allowWrite, createExport, fileName, fingerprint, pickers, projectFile, writeExport, writeProject, type ExportBatch, type FileTarget, type Folder } from "./project-files";
import { getDrafts, getFolder, getSavedTarget, putFolder, putSaved, type Draft } from "./project-storage";
import { GUIDES } from "./guides";
import { SAMPLES } from "./samples";
import { deleteBank, getPref, listBanks, setPref } from "./storage";
import { AcidSynth } from "./synth";
import { useProject } from "./use-project";
import { zipFiles } from "./zip";
import { dragValue, sliderKey, THEMES, trackDrag } from "./panel/gesture";
import { Knob } from "./panel/knob";
import { Scope } from "./panel/scope";
import { getPanelTheme, PANEL_THEMES, resolvePanelTheme, type PanelTheme } from "./panel/themes";
import { ActionRow, InfoRow, MenuItem, MenuNote, MenuShell, PrimaryButton, ValueRow } from "./panel/menu";
import { version } from "../package.json";

const randomSeed = () => Math.floor(Math.random() * 100000);
const legacyBpm = () => Math.min(160, Math.max(80, Number(getPref("bpm")) || 128));
const pad = (n: number) => String(n).padStart(2, "0");

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

function loadVolume(): number {
  const v = Number(getPref("volume") ?? 70);
  return Number.isInteger(v) && v >= 0 && v <= 100 ? v : 70;
}

function loadTheme(): PanelTheme {
  return resolvePanelTheme(new URLSearchParams(location.search).get("theme"), getPref("theme"));
}

type OpenRequest = { project: Project; target: FileTarget | null; draft?: Draft };
type SeqImport = Extract<Imported, { kind: "pattern" }>;
type Screen = "root" | "themes" | "gen" | "file" | "midi" | "drafts" | "import" | "pending" | "about" | "samples" | "guides";
const gateName: Record<Step["gate"], string> = { on: "Sonido", off: "Silencio", tie: "Ligadura" };
const cancelled = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/** Perillas del panel, en el orden del TD-3. Volume es local; el resto vive en el proyecto. */
const PANEL_KNOBS: { key: ToneKey | "volume"; label: string }[] = [
  { key: "tuning", label: "TUNING" }, { key: "cutoff", label: "CUT OFF" },
  { key: "resonance", label: "RESO" }, { key: "envelope", label: "ENV MOD" },
  { key: "decay", label: "DECAY" }, { key: "accent", label: "ACCENT" },
  { key: "drive", label: "DRIVE" }, { key: "volume", label: "VOLUME" },
];
const VOLUME = { min: 0, max: 100, step: 1, unit: "%", initial: 70 };

// Notas de un paso como índice 0–35 (octava −1 a +1), para tocar y arrastrar semitonos.
const noteIndex = (s: Step) => (s.octave + 1) * 12 + NOTES.indexOf(s.note);
function withNote(s: Step, index: number): Step {
  const n = ((index % 36) + 36) % 36;
  return { ...s, note: NOTES[n % 12]!, octave: (Math.floor(n / 12) - 1) as Step["octave"] };
}
const tapStep = (s: Step): Step => s.gate === "off" ? { ...s, gate: "on" } : withNote(s, noteIndex(s) + 1);
const LONG_PRESS_MS = 420;
const DRAG_SLOP = 10;
const PX_PER_SEMITONE = 14;

const sounding = (s: Step): Step["gate"] => s.gate === "off" ? "on" : s.gate;
/** Barra que aparece al mantener un paso. */
const STRIP: { label: string; active: (s: Step) => boolean; change: (s: Step) => Step }[] = [
  { label: "OCT−", active: (s) => s.octave === -1, change: (s) => ({ ...s, octave: Math.max(-1, s.octave - 1) as Step["octave"] }) },
  { label: "OCT+", active: (s) => s.octave === 1, change: (s) => ({ ...s, octave: Math.min(1, s.octave + 1) as Step["octave"] }) },
  { label: "ACC", active: (s) => s.accent, change: (s) => ({ ...s, accent: !s.accent, gate: sounding(s) }) },
  { label: "SLIDE", active: (s) => s.slide, change: (s) => ({ ...s, slide: !s.slide, gate: sounding(s) }) },
  { label: "TIE", active: (s) => s.gate === "tie", change: (s) => ({ ...s, gate: s.gate === "tie" ? "on" : "tie" }) },
  { label: "REST", active: (s) => s.gate === "off", change: (s) => ({ ...s, gate: s.gate === "off" ? "on" : "off" }) },
];

function stepDescription(s: Step, beyond: boolean): string {
  const body = s.gate === "on" ? `${s.note}, octava ${s.octave}${s.accent ? ", acento" : ""}${s.slide ? ", slide" : ""}` : gateName[s.gate];
  return body + (beyond ? ", fuera del largo" : "");
}

export function App() {
  const session = useProject(() => createProject(loadOpts(), legacyBpm()));
  const { current, history, sessionId, dirty, recoverable, draftError, target, commit, move } = session;
  const { bank, generator: opts, bpm } = current;
  const [key, setKey] = useState<PatternKey>("A");
  const [sel, setSel] = useState<number | null>(null);
  const [playStep, setPlayStep] = useState(-1);
  const [playing, setPlaying] = useState(false);
  // Valores en vivo mientras dura un gesto; se confirman en el historial al soltar.
  const [toneGesture, setToneGesture] = useState<{ control: ToneKey; value: number } | null>(null);
  const [stepGesture, setStepGesture] = useState<{ index: number; step: Step } | null>(null);
  const [bpmDraft, setBpmDraft] = useState<number | null>(null);
  const [lenDraft, setLenDraft] = useState<number | null>(null);
  const [volume, setVolume] = useState(loadVolume);
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null);
  const [themeId, setThemeId] = useState(loadTheme);
  const model = getPanelTheme(themeId);
  const theme = model.finish;
  const [rhythm, setRhythm] = useState({ kick: false, hats: false });
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [screen, setScreen] = useState<Screen | null>(() => model.opensFile ? "file" : null);
  const [folder, setFolder] = useState<Folder>();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const recoverableDrafts = drafts.filter((draft) => draft.session !== sessionId);
  const offeredRecovery = useRef(false);
  const [legacy, setLegacy] = useState(listBanks);
  const [pendingSeq, setPendingSeq] = useState<SeqImport | null>(null);
  const [destination, setDestination] = useState<PatternKey>("A");
  // Pantalla a la que vuelve ← desde "import": la que lo abrió.
  const [importBack, setImportBack] = useState<Screen>("root");
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

  const gesturing = !!(toneGesture || stepGesture || bpmDraft !== null || lenDraft !== null);
  const stored = bank.patterns[key];
  const pattern: Pattern = useMemo(() => {
    if (!stepGesture && lenDraft === null) return stored;
    const steps = stepGesture ? stored.steps.map((s, i) => i === stepGesture.index ? stepGesture.step : s) : stored.steps;
    return { ...stored, steps, length: lenDraft ?? stored.length };
  }, [stored, stepGesture, lenDraft]);
  const tone = useMemo(() => {
    if (!toneGesture || current.tone[toneGesture.control] === toneGesture.value) return current.tone;
    return previewTone(current, toneGesture.control, toneGesture.value);
  }, [current, toneGesture]);
  const shownBpm = bpmDraft ?? bpm;
  const shownVolume = volumeDraft ?? volume;
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
    synth.bpm = shownBpm;
    synth.setTone(tone);
    synth.setVolume(shownVolume);
    synth.rhythm = model.unified ? rhythm : { kick: false, hats: false };
  }, [pattern, shownBpm, tone, shownVolume, synth, model.unified, rhythm]);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEMES.find((t) => t.id === theme)!.color);
  }, [theme]);

  // Borradores: se consultan al abrir y cada vez que se ve el menú. La primera vez que aparecen
  // borradores de otra sesión, el menú se abre en BORRADORES (antes era una tarjeta al pie).
  useEffect(() => {
    if (offeredRecovery.current && screen !== "root" && screen !== "drafts") return;
    let active = true;
    const refresh = () => {
      void getDrafts().then((items) => {
        if (!active) return;
        setDrafts(items);
        if (!offeredRecovery.current) {
          offeredRecovery.current = true;
          if (items.some((d) => d.session !== sessionId)) setScreen((s) => s ?? "drafts");
        }
      }).catch(() => { offeredRecovery.current = true; });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, [screen, sessionId]);

  useEffect(() => {
    if (!msg || msg.error) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || gesturing) return;
      const element = event.target;
      if (element instanceof HTMLElement && (element.matches("input, textarea, select") || element.isContentEditable)) return;
      const pressed = event.key.toLowerCase();
      if (pressed !== "z" && pressed !== "y") return;
      event.preventDefault();
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

  function cycle<T extends string>(list: readonly T[], value: T, by: number): T {
    return list[(list.indexOf(value) + by + list.length) % list.length]!;
  }

  function doGenerate(seed = opts.seed) {
    commit((p) => {
      const generator = { ...p.generator, seed };
      return { ...p, generator, bank: generate(generator) };
    }, "generación");
    setSel(null);
    setScreen(null);
    info(`GEN ${seed}`);
  }

  function updateBank(mut: (b: Bank) => void, label = "edición de patrón") {
    commit((p) => {
      const next = cloneBank(p.bank);
      mut(next);
      return { ...p, bank: next };
    }, label);
  }

  function setStep(index: number, value: Step) {
    updateBank((b) => { b.patterns[key].steps[index] = value; }, `edición del paso ${index + 1}`);
  }

  function editSel(change: (s: Step) => Step) {
    if (sel !== null && step) setStep(sel, change(step));
  }

  function previewTone(project: Project, control: ToneKey, value: number): Project["tone"] {
    if (project.tone[control] === value) return project.tone;
    const next = { ...project.tone, [control]: value };
    if (control === "accent") delete next.legacySlideAccent;
    return next;
  }

  function changeTone(control: ToneKey, value: number) {
    setToneGesture(null);
    commit((p) => ({ ...p, tone: previewTone(p, control, value) }), `cambio de ${TONE_CONTROLS[control].label.toLowerCase()}`);
  }

  function audition(s: Step) {
    if (!synth.playing) synth.preview(s);
  }

  // Paso: tocar = nota +1 · arrastrar ↕ = semitonos · mantener = barra de acento/slide.
  function stepDown(e: PointerEvent, index: number) {
    if (e.button !== 0) return;
    const base = pattern.steps[index]!;
    let moved = false;
    let long = false;
    let last = base;
    const timer = setTimeout(() => {
      if (moved) return;
      long = true;
      setSel(index);
      navigator.vibrate?.(12);
    }, LONG_PRESS_MS);
    trackDrag(e, {
      move: (dy) => {
        if (long) return;
        if (!moved && Math.abs(dy) > DRAG_SLOP) {
          moved = true;
          clearTimeout(timer);
        }
        if (!moved) return;
        const next = withNote({ ...base, gate: base.gate === "off" ? "on" : base.gate }, noteIndex(base) + Math.round(dy / PX_PER_SEMITONE));
        if (next.note === last.note && next.octave === last.octave && next.gate === last.gate) return;
        last = next;
        setStepGesture({ index, step: next });
        audition(next);
      },
      end: (wasCancelled) => {
        clearTimeout(timer);
        setStepGesture(null);
        if (long || wasCancelled) return;
        const next = moved ? last : tapStep(base);
        if (next !== base) setStep(index, next);
        if (!moved) audition(next);
      },
    });
  }

  function stepKey(e: KeyboardEvent, index: number) {
    const s = pattern.steps[index]!;
    if (e.key === "Enter" && e.shiftKey || e.key === "ContextMenu") {
      e.preventDefault();
      setSel(index === sel ? null : index);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const next = tapStep(s);
      setStep(index, next);
      audition(next);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = withNote({ ...s, gate: s.gate === "off" ? "on" : s.gate }, noteIndex(s) + (e.key === "ArrowUp" ? 1 : -1));
      setStep(index, next);
      audition(next);
    }
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
        setScreen("pending");
        return;
      }
      setKey("A");
      setSel(null);
      setToneGesture(null);
      setPendingOpen(null);
      setPendingSeq(null);
      setSaveName(null);
      setScreen(null);
      info(`Abierto «${request.project.bank.name}»`);
    } catch (e) {
      fail(e);
    }
  }

  function requestOpen(request: OpenRequest) {
    if (latest.current.dirty) {
      setPendingOpen(request);
      setScreen("pending");
    } else void openNow(request);
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
        offerImport(imported, "root");
      }
    } catch (e) {
      fail(e);
    }
  }

  function offerImport(seq: SeqImport, back: Screen) {
    setPendingSeq(seq);
    setDestination(key);
    setImportBack(back);
    setScreen("import");
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
      setScreen("file");
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
      if (screen === "file") setScreen(null);
      const place = result.folder?.name ?? result.name;
      info(`WRITE OK · ${place}`);
      try {
        await putSaved(snapshot, result, sessionId);
      } catch {
        info(`Guardado en ${place}. El destino quedó disponible en esta sesión.`);
      }
      if (pendingOpen && projectText(latest.current.current) === projectText(snapshot)) await openNow(pendingOpen);
    } catch (e) {
      setScreen("file");
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
      info(`4/4 .SEQ en ${batch.name}`);
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
      info("ZIP ↓");
    } catch (e) {
      fail(e);
    }
  }

  function closeMenu() {
    if (screen === "import") setPendingSeq(null);
    if (screen === "pending") setPendingOpen(null);
    setSaveName(null);
    setScreen(null);
  }

  function backMenu() {
    if (screen === "root") return closeMenu();
    if (screen === "import") setPendingSeq(null);
    if (screen === "pending") setPendingOpen(null);
    setSaveName(null);
    setScreen(screen === "import" ? importBack : "root");
  }

  function changeTheme(next: PanelTheme) {
    setThemeId(next);
    setPref("theme", next);
    const url = new URL(location.href);
    url.searchParams.set("theme", next);
    window.history.replaceState(null, "", url);
    setScreen(getPanelTheme(next).opensFile ? "file" : null);
  }

  function densityStep(by: number) {
    const d = Math.round((opts.density + by) * 20) / 20;
    setOpt("density", d > 1.001 ? 0.1 : d < 0.099 ? 1 : d);
  }

  const scaleIds = Object.keys(SCALES) as ScaleId[];
  const styleIds = Object.keys(STYLES) as StyleId[];

  const fullStatus = dirty
    ? recoverable ? "Borrador local" : draftError ? "Cambios sin guardar · borrador no disponible" : "Cambios sin guardar"
    : target ? `Guardado en ${target.folder?.name ?? target.name}` : "Sesión abierta";
  const status = dirty ? (draftError ? "● EDIT !" : "● EDIT") : target ? "SAVED" : "NEW";
  const themeLabel = `${model.id} · ${model.label}`;
  const negro = theme === "negro";

  function renderMenu() {
    if (!screen) return null;
    const titles: Record<Screen, string> = {
      root: "MENÚ", themes: "MATERIAL", gen: "GENERADOR", file: "ARCHIVO", midi: "MIDI · TD-3", drafts: "BORRADORES",
      import: "IMPORTAR .SEQ", pending: "SIN GUARDAR", about: "ACERCA DE",
      samples: "EJEMPLOS", guides: "GUÍAS",
    };
    return (
      <MenuShell title={titles[screen]} footer={bank.name} onBack={backMenu} onClose={closeMenu}>
        {screen === "root" && <div class="m-sections"><div class="m-list">
          <MenuItem label="GENERADOR" sub={`${opts.tonic} ${SCALES[opts.scale].label.toLowerCase()} · ${STYLES[opts.style].label.toLowerCase()}`} onClick={() => setScreen("gen")} />
          <MenuItem label="ARCHIVO" sub={target ? target.name : "Proyecto · exportar .seq"} onClick={() => setScreen("file")} />
          <MenuItem label="EJEMPLOS" sub={`${SAMPLES.length} patrones de referencia`} onClick={() => setScreen("samples")} />
          <MenuItem label="GUÍAS" sub={`${GUIDES.length} manual${GUIDES.length === 1 ? "" : "es"} · PDF`} onClick={() => setScreen("guides")} />
          <MenuItem label="MIDI" sub="Enviar patrón al TD-3 · experimental" onClick={() => setScreen("midi")} />
          <MenuItem label="BORRADORES" sub={`${recoverableDrafts.length} recuperable${recoverableDrafts.length === 1 ? "" : "s"}`} onClick={() => setScreen("drafts")} />
        </div><div class="m-file-group">
          <h2 class="m-group-title">Panel</h2>
          <div class="m-list"><MenuItem label="MATERIAL" sub="Elegir modelo del panel" value={themeLabel} onClick={() => setScreen("themes")} /></div>
        </div><div class="m-file-group">
          <h2 class="m-group-title">App</h2>
          <div class="m-list"><MenuItem label="ACERCA DE" sub={`Versión ${version}`} onClick={() => setScreen("about")} /></div>
        </div></div>}

        {screen === "about" && <div class="m-fill">
          <div class="m-list">
            <InfoRow label="APP" value="Acidlab 303" />
            <InfoRow label="VERSIÓN" value={version} />
            <InfoRow label="PARA" value="Behringer TD-3" />
          </div>
          <MenuNote>Generador y editor de patrones ácidos para Behringer TD-3. Funciona sin conexión una vez instalada.</MenuNote>
        </div>}

        {screen === "samples" && <div class="m-list">
          {SAMPLES.map((s) => "error" in s
            ? <ActionRow key={s.file} label={s.title} sub={`${s.detail} · ${s.error}`} disabled onClick={() => {}} />
            : <ActionRow key={s.file} label={s.title} sub={s.detail} onClick={() => offerImport(s.imported, "samples")} />)}
        </div>}

        {screen === "guides" && <div class="m-fill">
          <div class="m-list">
            {GUIDES.map((g) => <ActionRow key={g.url} label={g.title} sub="PDF · abre en pestaña nueva" onClick={() => window.open(g.url, "_blank", "noopener")} />)}
          </div>
          <MenuNote>Los manuales quedan guardados en el dispositivo y se pueden leer sin conexión.</MenuNote>
        </div>}

        {screen === "themes" && <div class="m-list m-themes">
          {PANEL_THEMES.map((option) => <button class="m-item theme-option" key={option.id}
            aria-pressed={option.id === themeId} onClick={() => changeTheme(option.id)}>
            <span class="theme-chip" data-finish={option.finish} aria-hidden="true" />
            <span class="m-item-text"><span class="m-item-label">{option.id} · {option.label}</span></span>
            {option.id === themeId && <span class="m-value">Activo</span>}
          </button>)}
        </div>}

        {screen === "gen" && <div class="m-fill">
          <div class="m-list">
            <ValueRow label="TÓNICA" value={opts.tonic} onClick={() => setOpt("tonic", cycle(NOTES, opts.tonic, 1) as Note)}
              onPrev={() => setOpt("tonic", cycle(NOTES, opts.tonic, -1) as Note)} />
            <ValueRow label="ESCALA" value={SCALES[opts.scale].label.toUpperCase()} onClick={() => setOpt("scale", cycle(scaleIds, opts.scale, 1))}
              onPrev={() => setOpt("scale", cycle(scaleIds, opts.scale, -1))} />
            <ValueRow label="ESTILO" value={STYLES[opts.style].label.toUpperCase()} onClick={() => setOpt("style", cycle(styleIds, opts.style, 1))}
              onPrev={() => setOpt("style", cycle(styleIds, opts.style, -1))} />
            <ValueRow label="DENSIDAD" value={`${Math.round(opts.density * 100)}%`} onClick={() => densityStep(0.1)} onPrev={() => densityStep(-0.1)} />
            <ValueRow label="SEMILLA" value={String(opts.seed)} onClick={() => setOpt("seed", randomSeed())} />
          </div>
          <MenuNote>Tocá un valor para cambiarlo (SEMILLA sortea una nueva). Generar reemplaza los patrones A–D; se puede deshacer.</MenuNote>
          <div class="m-spacer" />
          <PrimaryButton onClick={() => doGenerate()}>GENERAR</PrimaryButton>
        </div>}

        {screen === "file" && <div class="m-sections">
          <div class="m-file-group"><h2 class="m-group-title">Proyecto</h2><div class="m-list">
          <ActionRow label="Carpeta de trabajo" sub={folder?.name ?? "Sin carpeta · elegir"} disabled={!pickers.showDirectoryPicker || busy} onClick={() => void chooseFolder()} />
          <ActionRow label="Abrir proyecto" sub=".acidlab.json o banco .json" disabled={busy} onClick={() => void chooseProject()} />
          <ActionRow label="Guardar" sub={target ? target.name : "Elegir nombre y carpeta"} disabled={busy} onClick={() => void save()} />
          <ActionRow label="Guardar como" sub={`${bank.name}.acidlab.json`} disabled={busy} onClick={() => setSaveName(`${bank.name}.acidlab.json`)} />
          <ActionRow label="Descargar proyecto" sub={target?.name ?? `${bank.name}.acidlab.json`} onClick={() => { download(projectFile(current)); info("Descarga iniciada"); }} />
          </div>
          {saveName !== null && <form class="m-form" onSubmit={(e) => { e.preventDefault(); void save(saveName); }}>
            <label class="m-field">NOMBRE DE ARCHIVO
              <input type="text" required maxLength={100} value={saveName} onInput={(e) => setSaveName(e.currentTarget.value)} />
            </label>
            {!folder && <MenuNote>Elegí una carpeta de trabajo para guardar, o descargá el proyecto.</MenuNote>}
            <div class="m-form-row">
              <button type="button" class="m-secondary" onClick={() => setSaveName(null)}>CANCELAR</button>
              <PrimaryButton type="submit" disabled={busy || !folder}>GUARDAR</PrimaryButton>
            </div>
          </form>}
          </div>
          <div class="m-file-group"><h2 class="m-group-title">Patrones .seq</h2><div class="m-list">
          <ActionRow label="Importar .seq" sub="a un patrón A–D" disabled={busy} onClick={() => fileInput.current?.click()} />
          <ActionRow label="Exportar A–D" sub={folder ? `4 × .seq para SynthTribe en ${folder.name}` : "4 × .seq · requiere carpeta"} disabled={!folder || busy} onClick={() => void exportPatterns()} />
          {exportBatch && <ActionRow label="Reintentar pendientes"
            sub={`${exportBatch.written} de 4 escritos${exportBatch.written > 0 ? ` · ${exportBatch.files.slice(0, exportBatch.written).map((f) => f.name).join(", ")}` : ""}`}
            disabled={!folder || busy} onClick={() => void exportPatterns(true)} />}
          <ActionRow label="Descargar ZIP" sub="patrones A–D" onClick={() => void downloadZip()} />
          {canShareSeq && <ActionRow label="Compartir .seq" sub="Drive, Telegram…" onClick={() => void sharePatterns()} />}
          </div></div>
          <div class="m-file-group"><h2 class="m-group-title">Banco</h2><div class="m-list">
          <ActionRow label="Descargar banco JSON" sub={`${bank.name}.json`} onClick={() => { download(jsonFile(bank)); info("JSON ↓"); }} />
          {legacy.length > 0 && <details class="m-details"><summary>Bancos locales anteriores</summary>
            {legacy.map((b) => <div class="m-draft" key={b.name}>
              <span class="m-draft-name">{b.name}</span>
              <span class="m-draft-actions">
                <button class="m-secondary" onClick={() => requestOpen({ project: parseProjectText(JSON.stringify(b), loadOpts(), legacyBpm()).project, target: null })}>ABRIR</button>
                <button class="m-secondary" aria-label={`Borrar ${b.name}`} onClick={() => {
                  if (!confirm(`¿Borrar «${b.name}» de los bancos locales anteriores?`)) return;
                  if (deleteBank(b.name)) setLegacy(listBanks());
                  else fail(new Error("No se pudo borrar el banco local"));
                }}>BORRAR</button>
              </span>
            </div>)}
          </details>}
          </div></div>
        </div>}

        {screen === "midi" && <MidiPanel pattern={pattern} patternKey={key} onMessage={info} onError={fail} />}

        {screen === "drafts" && <div class="m-fill">
          <div class="m-list">
            {recoverableDrafts.length === 0 && <MenuNote>No hay borradores para recuperar.</MenuNote>}
            {recoverableDrafts.map((draft) => <div class="m-draft" key={`${draft.project.id}/${draft.session}`}>
              <span class="m-draft-text">
                <span class="m-draft-name">{draft.project.bank.name}</span>
                <span class="m-sub">{new Date(draft.updated).toLocaleString()}</span>
              </span>
              <button class="m-secondary" disabled={busy} onClick={() => requestOpen({ project: draft.project, target: null, draft })}>RECUPERAR</button>
            </div>)}
          </div>
          <div class="m-spacer" />
          {recoverableDrafts.length > 0 && <button class="m-secondary wide" onClick={closeMenu}>AHORA NO</button>}
        </div>}

        {screen === "import" && pendingSeq && <div class="m-fill">
          <MenuNote>{pendingSeq.name} · firmware {pendingSeq.firmware}</MenuNote>
          <div class="m-row static"><span class="m-row-label">PATRÓN DE DESTINO</span></div>
          <div class="m-choices" role="radiogroup" aria-label="Patrón de destino">
            {PATTERN_KEYS.map((k) => <button key={k} role="radio" aria-checked={k === destination} class={k === destination ? "on" : ""} onClick={() => setDestination(k)}>{k}</button>)}
          </div>
          <MenuNote>Reemplaza el patrón {destination}; se puede deshacer.</MenuNote>
          <div class="m-spacer" />
          <PrimaryButton onClick={() => {
            updateBank((b) => { b.patterns[destination] = pendingSeq.pattern; }, `importación del patrón ${destination}`);
            setKey(destination);
            setSel(null);
            setPendingSeq(null);
            setScreen(null);
            info(`IMPORT → ${destination}`);
          }}>IMPORTAR EN {destination}</PrimaryButton>
        </div>}

        {screen === "pending" && pendingOpen && <div class="m-fill">
          <MenuNote>Guardá esta sesión antes de abrir «{pendingOpen.project.bank.name}» o seguí editando.</MenuNote>
          <div class="m-list">
            <ActionRow label="Abrir y conservar borrador" sub="Los cambios quedan en BORRADORES" disabled={busy} onClick={() => void openNow(pendingOpen)} />
            <ActionRow label="Seguir editando" disabled={busy} onClick={closeMenu} />
          </div>
          <div class="m-spacer" />
          <PrimaryButton disabled={busy} onClick={() => void save()}>GUARDAR Y ABRIR</PrimaryButton>
        </div>}
      </MenuShell>
    );
  }

  return (
    <main class="panel" data-theme={theme} data-model={themeId} data-layout={model.unified ? "unified" : "classic"} aria-label="AcidLab 303">
      <div class="panel-body" inert={screen !== null}>
      <header class="p-head">
        <div class="brand">
          <span class={playing ? "brand-led on" : "brand-led"} aria-hidden="true" />
          <h1><span class="b-name">ACIDLAB</span> <span class="b-num">303</span></h1>
          <span class="b-sub">BASS LINE</span>
        </div>
        {model.unified && <Scope synth={synth} playing={playing && !screen} />}
        <button class="btn menu-btn" aria-haspopup="dialog" onClick={() => setScreen("root")}>
          MENU{recoverableDrafts.length > 0 && <span class="menu-dot" aria-label="Hay borradores" />}
        </button>
      </header>

      <div class="tone-block">
      <section class="lcd" aria-label="Display">
        <span class="glare" aria-hidden="true" />
        {msg && !msg.error
          ? <div class="l-msg" role="status">{msg.text}</div>
          : <>
            <div class="l-name">{bank.name}</div>
            <div class="l-status" title={fullStatus} aria-label={fullStatus}>{status}</div>
          </>}
        <div class="l-bpm" role="slider" tabIndex={0} aria-label="Tempo" aria-valuemin={80} aria-valuemax={160} aria-valuenow={shownBpm} aria-valuetext={`${shownBpm} BPM`}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            dragValue(e, { value: bpm, min: 80, max: 160, px: 6 }, setBpmDraft, (v) => {
              setBpmDraft(null);
              if (v !== null) commit((p) => ({ ...p, bpm: v }), "tempo");
            });
          }}
          onKeyDown={(e) => {
            const v = sliderKey(e.key, bpm, 80, 160);
            if (v === null) return;
            e.preventDefault();
            commit((p) => ({ ...p, bpm: v }), "tempo");
          }}>
          <span class="l-big">{shownBpm}</span><span class="l-unit">BPM ↕</span>
        </div>
        <div class="l-right">
          <span class="l-key">{key}</span>
          <span class="l-pos">{playStep >= 0 ? pad(playStep + 1) : "--"}/{pad(pattern.length)}</span>
        </div>
      </section>

      <section class="timbre" aria-label="Timbre">
        {model.unified && <div class="engraving" aria-hidden="true">Tone</div>}
        <div class="knobs">
        {PANEL_KNOBS.map(({ key: control, label }) => {
          if (control === "volume") {
            return <Knob key={control} label={label} value={shownVolume} {...VOLUME}
              preview={setVolumeDraft} cancel={() => setVolumeDraft(null)}
              commit={(v) => { setVolumeDraft(null); setVolume(v); setPref("volume", String(v)); }} />;
          }
          const { min, max, step: increment, unit } = TONE_CONTROLS[control];
          return <Knob key={control} label={label} value={tone[control]} min={min} max={max} step={increment} unit={unit}
            initial={DEFAULT_TONE[control]}
            preview={(value) => setToneGesture({ control, value })}
            cancel={() => setToneGesture(null)} commit={(value) => changeTone(control, value)} />;
        })}
        </div>
      </section>
      </div>

      <div class="sequence-block">
      {model.unified && <div class="engraving" aria-hidden="true">Sequencer</div>}
      <section class="bar" aria-label="Patrón">
        <div class="pats" role="tablist" aria-label="Variantes">
          {PATTERN_KEYS.map((k, i) => (
            <div class="pat" key={k}>
              <span class={k === key ? "led on" : "led"} aria-hidden="true" />
              <button id={`tab-${k}`} role="tab" aria-controls="pattern-steps" aria-selected={k === key} tabIndex={k === key ? 0 : -1}
                class={k === key ? "btn on" : "btn"}
                onClick={() => { setKey(k); setSel(null); }}
                onKeyDown={(e) => {
                  const positions: Record<string, number> = { ArrowRight: (i + 1) % 4, ArrowLeft: (i + 3) % 4, Home: 0, End: 3 };
                  if (!Object.hasOwn(positions, e.key)) return;
                  e.preventDefault();
                  const index = positions[e.key]!;
                  setKey(PATTERN_KEYS[index]!);
                  setSel(null);
                  document.getElementById(`tab-${PATTERN_KEYS[index]!}`)?.focus();
                }}>{k}</button>
            </div>
          ))}
        </div>
        <div class="mods">
          <div class="len">
            <span class="len-label" aria-hidden="true">LEN ↕</span>
            <div class="len-box" role="slider" tabIndex={0} aria-label="Largo del patrón" aria-valuemin={1} aria-valuemax={16} aria-valuenow={pattern.length}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                dragValue(e, { value: stored.length, min: 1, max: 16, px: 12 }, setLenDraft, (v) => {
                  setLenDraft(null);
                  if (v !== null) updateBank((b) => { b.patterns[key].length = v; }, "largo del patrón");
                });
              }}
              onKeyDown={(e) => {
                const v = sliderKey(e.key, stored.length, 1, 16);
                if (v === null) return;
                e.preventDefault();
                updateBank((b) => { b.patterns[key].length = v; }, "largo del patrón");
              }}>
              <span class="len-in" aria-hidden="true">LEN ↕</span>
              <span>{pad(pattern.length)}</span>
            </div>
          </div>
          <div class="mod">
            <span class={pattern.triplet ? "led on" : "led"} aria-hidden="true" />
            <button class="btn" aria-pressed={pattern.triplet} aria-label="Tresillo"
              onClick={() => updateBank((b) => { b.patterns[key].triplet = !b.patterns[key].triplet; }, "tresillo")}>
              <span class={pattern.triplet ? "corner on" : "corner"} aria-hidden="true" />TRI
            </button>
          </div>
          <div class="mod">
            <span class={tone.driveEnabled ? "led on" : "led"} aria-hidden="true" />
            <button class="btn" aria-pressed={tone.driveEnabled} aria-label="Drive (FX)"
              onClick={() => commit((p) => ({ ...p, tone: { ...p.tone, driveEnabled: !p.tone.driveEnabled } }), "bypass de Drive")}>
              <span class={tone.driveEnabled ? "corner on" : "corner"} aria-hidden="true" />FX
            </button>
          </div>
        </div>
      </section>

      <section class="steps" id="pattern-steps" role="tabpanel" aria-labelledby={`tab-${key}`}>
        {Array.from({ length: 4 }, (_, group) => (
          <div class="group" key={group}>
            {pattern.steps.slice(group * 4, group * 4 + 4).map((s, j) => {
              const i = group * 4 + j;
              const beyond = i >= pattern.length;
              const classes = ["cell", s.gate !== "off" && "lit", i === sel && "sel", i === playStep && "now"].filter(Boolean).join(" ");
              return (
                <div class={beyond ? "step beyond" : "step"} key={i}>
                  <span class={i === playStep ? "led on" : "led"} aria-hidden="true" />
                  <button class={classes} aria-label={`Paso ${i + 1}`} aria-description={stepDescription(s, beyond)} aria-pressed={i === sel}
                    onPointerDown={(e) => stepDown(e, i)}
                    onKeyDown={(e) => stepKey(e, i)}
                    onContextMenu={(e) => { e.preventDefault(); setSel(i); }}>
                    <span class="c-lit" aria-hidden="true" />
                    <span class="c-now" aria-hidden="true" />
                    <span class="c-sel" aria-hidden="true" />
                    <span class="c-label" aria-hidden="true">
                      {s.gate === "off" ? "" : s.gate === "tie" ? "—" : s.note}
                      <sup>{s.gate === "on" && s.octave !== 0 ? (s.octave > 0 ? "+" : "−") : ""}</sup>
                    </span>
                    <span class={s.gate !== "off" && s.accent ? "c-acc on" : "c-acc"} aria-hidden="true" />
                    <span class={s.gate !== "off" && s.slide ? "c-sld on" : "c-sld"} aria-hidden="true" />
                  </button>
                  <span class="num" aria-hidden="true">{pad(i + 1)}</span>
                </div>
              );
            })}
          </div>
        ))}
      </section>

      <section class="strip" aria-label="Edición del paso">
        {step && sel !== null ? (
          <div class="strip-edit">
            <span class="strip-label">STEP {pad(sel + 1)}</span>
            {STRIP.map(({ label, active, change }) => (
              <button key={label} class="btn strip-btn" aria-pressed={active(step)} onClick={() => editSel(change)}>
                <span>{label}</span><span class={active(step) ? "bar-led on" : "bar-led"} aria-hidden="true" />
              </button>
            ))}
            <button class="strip-close" aria-label="Cerrar edición del paso" onClick={() => setSel(null)}>✕</button>
          </div>
        ) : (
          <div class="hints" aria-hidden="true"><span>TAP · NOTA</span><span>↕ · SEMITONO</span><span>MANTENER · ACC/SLIDE</span></div>
        )}
      </section>

      </div>

      {model.unified && <section class="performance" aria-label="Generador y ritmo">
        <div class="quick-gen">
          <span class="quick-title" aria-hidden="true">Random</span>
          {([
            ["Tónica", opts.tonic, () => setOpt("tonic", cycle(NOTES, opts.tonic, 1))],
            ["Escala", opts.scale === "menor-natural" ? "MENOR" : SCALES[opts.scale].label.toUpperCase(),
              () => setOpt("scale", cycle(scaleIds, opts.scale, 1))],
            ["Estilo", STYLES[opts.style].label.toUpperCase(), () => setOpt("style", cycle(styleIds, opts.style, 1))],
            ["Dens", `${Math.round(opts.density * 100)}%`, () => densityStep(0.1)],
          ] satisfies [string, string, () => void][]).map(([label, value, change]) => <button type="button" key={label} aria-label={`${label}: ${value}`} onClick={change}>
            <span>{label}</span><strong>{value}</strong>
          </button>)}
          <button class="btn quick-random" aria-label="Generar patrones al azar" onClick={() => doGenerate(randomSeed())}>GEN</button>
        </div>
        <div class="rhythm" aria-label="Ritmo">
          {(["kick", "hats"] as const).map((part) => <button key={part} role="switch" aria-checked={rhythm[part]}
            onClick={() => setRhythm((state) => ({ ...state, [part]: !state[part] }))}>
            {part}<span class="switch-track" aria-hidden="true"><span /></span>
          </button>)}
        </div>
      </section>}

      <section class="transport" aria-label="Transporte">
        <button class={playing ? "btn run playing" : "btn run"} aria-pressed={playing} onClick={() => void togglePlay()}>
          <span class="run-fill" aria-hidden="true" />
          <span class="led" aria-hidden="true" />
          <span class="run-text">{negro ? (playing ? "STOP" : "RUN") : "RUN/STOP"}</span>
        </button>
        <button class="btn" disabled={!undo || gesturing} aria-label={undo ? `Deshacer ${undo}` : "Deshacer"} title={undo}
          onClick={() => { move("undo"); info("UNDO"); }}><span class="transport-mark" aria-hidden="true">↶</span>UNDO</button>
        <button class="btn" disabled={!redo || gesturing} aria-label={redo ? `Rehacer ${redo}` : "Rehacer"} title={redo}
          onClick={() => { move("redo"); info("REDO"); }}><span class="transport-mark" aria-hidden="true">↷</span>REDO</button>
        <button class="btn" disabled={busy} aria-label="Guardar (write)" onClick={() => void save()}><span class="transport-mark" aria-hidden="true">↓</span>WRITE
          {dirty && <span class="write-dot" aria-hidden="true" />}</button>
      </section>

      </div>

      {msg?.error && <div class="toast" role="alert">
        <span>{msg.text}</span><button aria-label="Cerrar aviso" onClick={() => setMsg(null)}>✕</button>
      </div>}

      {renderMenu()}

      <input ref={fileInput} type="file" accept=".seq,.json,application/json" hidden onChange={(e) => void onImport(e.currentTarget)} />
    </main>
  );
}
