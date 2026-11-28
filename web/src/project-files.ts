import { newId, projectText, type Project } from "./project";

interface Permissions {
  queryPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
}

export interface Folder extends FileSystemDirectoryHandle, Permissions {}
export interface LocalFile extends FileSystemFileHandle, Permissions {}

export const pickers = windowPickers();
function windowPickers() {
  return globalThis as typeof globalThis & {
    showDirectoryPicker?: (options: { mode: "readwrite" }) => Promise<Folder>;
    showOpenFilePicker?: (options: {
      types: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<LocalFile[]>;
  };
}

export async function allowWrite(handle: Permissions): Promise<void> {
  const options = { mode: "readwrite" } as const;
  if (await handle.queryPermission(options) === "granted") return;
  if (await handle.requestPermission(options) !== "granted") {
    throw new Error("Permiso de escritura denegado. Podés descargar una copia desde Archivo.");
  }
}

export interface FileTarget {
  name: string;
  file: LocalFile;
  fingerprint: string;
  folder?: Folder;
}

export async function fingerprint(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
}

async function write(file: FileSystemFileHandle, data: File): Promise<void> {
  const stream = await file.createWritable();
  try {
    await stream.write(data);
    await stream.close();
  } catch (error) {
    await stream.abort().catch(() => {});
    throw error;
  }
}

export function projectFile(project: Project, name = `${project.bank.name}.acidlab.json`): File {
  return new File([projectText(project)], name, { type: "application/json" });
}

type Lock = <T>(name: string, work: () => Promise<T>) => Promise<T>;
const lockFile: Lock = (name, work) => {
  if (!navigator.locks) throw new Error("Este navegador no permite coordinar escrituras. Descargá una copia desde Archivo.");
  return navigator.locks.request(`acidlab:file:${name.normalize("NFC").toLowerCase()}`, work);
};

export function fileName(input: string): string {
  const name = input.trim();
  if (!name || name === "." || name === ".." || /[\\/:*?"<>|]/.test(name) || [...name].some((c) => c.charCodeAt(0) < 32)) {
    throw new Error("Elegí un nombre de archivo válido");
  }
  return name.endsWith(".acidlab.json") ? name : `${name.replace(/\.json$/i, "")}.acidlab.json`;
}

// Un primer guardado fallido puede haber creado una entrada vacía. Solo esta sesión
// puede reintentar sobre una entrada que reconoce y que sigue intacta.
const incompleteFiles = new WeakMap<Folder, Map<string, FileSystemFileHandle>>();

export async function writeProject(
  folder: Folder | undefined, name: string, project: Project, previous: FileTarget | null, lock = lockFile,
): Promise<FileTarget> {
  return lock(name, async () => {
    const data = projectFile(project, name);
    const nextFingerprint = await fingerprint(data);
    if (previous) {
      const actual = await previous.file.getFile().then(fingerprint, (error: unknown) => {
        if (error instanceof DOMException && error.name === "NotFoundError") return null;
        throw error;
      });
      if (actual !== previous.fingerprint) throw new Error("El archivo cambió fuera de esta sesión. Usá Guardar como.");
      await write(previous.file, data);
      return { ...previous, fingerprint: nextFingerprint };
    }
    if (!folder) throw new Error("Elegí una carpeta de trabajo");
    const old = await folder.getFileHandle(name).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "NotFoundError") return null;
      throw error;
    });
    const incomplete = incompleteFiles.get(folder) ?? new Map<string, FileSystemFileHandle>();
    const priorAttempt = incomplete.get(name);
    if (old && !(priorAttempt && await old.isSameEntry(priorAttempt) && (await old.getFile()).size === 0)) {
      throw new Error("Ya existe un archivo con ese nombre. Usá Guardar como con otro nombre.");
    }
    const file = (old ?? await folder.getFileHandle(name, { create: true })) as LocalFile;
    incomplete.set(name, file);
    incompleteFiles.set(folder, incomplete);
    await write(file, data);
    incomplete.delete(name);
    return { name, file, folder, fingerprint: nextFingerprint };
  });
}

export interface ExportBatch {
  name: string;
  files: File[];
  written: number;
  directory?: FileSystemDirectoryHandle;
}

export function createExport(files: File[]): ExportBatch {
  const base = files[0]?.name.slice(0, -6) ?? "patrones";
  return { name: `${base}-${new Date().toISOString().replace(/[:.]/g, "-")}-${newId().slice(0, 8)}`, files, written: 0 };
}

export async function writeExport(folder: Folder, batch: ExportBatch): Promise<void> {
  batch.directory ??= await folder.getDirectoryHandle(batch.name, { create: true });
  for (const file of batch.files.slice(batch.written)) {
    await write(await batch.directory.getFileHandle(file.name, { create: true }), file);
    batch.written++;
  }
}
