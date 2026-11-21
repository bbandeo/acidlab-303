import type { FileTarget, Folder } from "./project-files";
import { projectText, type Project } from "./project";

export type DraftRevision = { session: string; updated: number };
export type Draft = DraftRevision & {
  project: Project;
  baseline: string;
  target?: FileTarget;
  previous?: DraftRevision[];
};
type Saved = { baseline: string; target: FileTarget; session: string; updated: number };
type Store = "drafts" | "saved" | "settings";
let opening: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("acidlab-projects", 1);
    request.onupgradeneeded = () => {
      for (const name of ["drafts", "saved", "settings"]) request.result.createObjectStore(name);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = undefined; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  }).catch((error: unknown) => {
    opening = undefined;
    throw error;
  });
  return opening;
}

async function transaction<T>(
  name: Store, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const request = run(tx.objectStore(name));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error ?? new Error("La transacción local se interrumpió"));
  });
}

export const putDraft = (draft: Draft) =>
  transaction("drafts", "readwrite", (store) => store.put(draft, [draft.project.id, draft.session]));
export const putSaved = (project: Project, target: FileTarget, session: string) =>
  transaction("saved", "readwrite", (store) => store.put({
    baseline: projectText(project), target, session, updated: Date.now(),
  }, [project.id, session]));

function savedForProject(id: string): Promise<Saved[]> {
  const range = IDBKeyRange.bound([id, ""], [id, "\uffff"]);
  return transaction("saved", "readonly", (store) => store.getAll(range));
}

async function sameFile(records: Saved[], file: FileTarget["file"]): Promise<Saved | undefined> {
  for (const record of records) {
    if (await file.isSameEntry(record.target.file).catch(() => false)) return record;
  }
}

export async function getSavedTarget(id: string, file: FileTarget["file"]): Promise<FileTarget | undefined> {
  const records = await savedForProject(id);
  return (await sameFile(records.sort((a, b) => b.updated - a.updated), file))?.target;
}
export const putFolder = (folder: Folder) =>
  transaction("settings", "readwrite", (store) => store.put(folder, "folder"));
export const getFolder = (): Promise<Folder | undefined> =>
  transaction("settings", "readonly", (store) => store.get("folder"));

export async function getDrafts(): Promise<Draft[]> {
  const all: Draft[] = await transaction("drafts", "readonly", (store) => store.getAll());
  const saved = new Map<string, Saved[]>();
  await Promise.all([...new Set(all.map(({ project }) => project.id))].map(async (id) => {
    saved.set(id, (await savedForProject(id)).sort((a, b) => b.updated - a.updated));
  }));
  const key = (id: string, revision: DraftRevision) => `${id}/${revision.session}/${revision.updated}`;
  const replaced = new Set(all.flatMap((draft) =>
    (draft.previous ?? []).map((revision) => key(draft.project.id, revision))));
  const recoverable = await Promise.all(all.map(async (draft) => {
    const { project, baseline, target, session } = draft;
    const content = projectText(project);
    if (replaced.has(key(project.id, draft)) || content === baseline) return null;
    const records = saved.get(project.id) ?? [];
    const lastSave = target ? await sameFile(records, target.file) : records.find((record) => record.session === session);
    return content === lastSave?.baseline ? null : draft;
  }));
  return recoverable.filter((draft) => draft !== null).sort((a, b) => b.updated - a.updated);
}
