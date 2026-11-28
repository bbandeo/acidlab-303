import { expect, it, vi } from "vitest";
import { createExport, writeExport, writeProject, type Folder } from "../src/project-files";
import { createProject, projectText } from "../src/project";
import { seqFiles } from "../src/io";

function folder() {
  const contents = new Map<string, File>();
  const close = vi.fn(async (name: string, data: File) => { contents.set(name, data); });
  const handles = new Map<string, { name: string }>();
  const files = {
    name: "Loops",
    getFileHandle(name: string, { create } = { create: false }) {
      if (!create && !contents.has(name)) return Promise.reject(new DOMException("", "NotFoundError"));
      if (handles.has(name)) return Promise.resolve(handles.get(name)!);
      if (create && !contents.has(name)) contents.set(name, new File([], name));
      const handle = {
        name,
        isSameEntry: async (other: unknown) => handle === other,
        getFile: async () => contents.get(name) ?? new File([], name),
        createWritable: async () => ({
          write: async (data: File) => { pending = data; },
          close: async () => close(name, pending),
          abort: async () => {},
        }),
      };
      handles.set(name, handle);
      return Promise.resolve(handle);
    },
    getDirectoryHandle: vi.fn(async () => files),
  } as unknown as Folder;
  let pending: File;
  return { files, contents, close };
}
const unlocked = <T>(_name: string, operation: () => Promise<T>) => operation();

it("rejects external edits and updates the fingerprint only after a successful close", async () => {
  const { files, contents, close } = folder();
  const project = createProject();
  const target = await writeProject(files, "banco.acidlab.json", project, null, unlocked);
  close.mockRejectedValueOnce(new Error("disk"));
  await expect(writeProject(files, target.name, { ...project, bpm: 150 }, target, unlocked)).rejects.toThrow("disk");
  expect(await contents.get(target.name)?.text()).toBe(projectText(project));
  contents.set(target.name, new File(["external"], target.name));
  await expect(writeProject(files, target.name, project, target, unlocked)).rejects.toThrow("Guardar como");
});

it("reports a partially completed batch and only retries the original pending files", async () => {
  const { files, close } = folder();
  close.mockImplementationOnce(async () => {}).mockImplementationOnce(async () => {})
    .mockRejectedValueOnce(new Error("Disk full"));
  const batch = createExport(seqFiles(createProject().bank));
  await expect(writeExport(files, batch)).rejects.toThrow("Disk full");
  expect(batch.written).toBe(2);
  await writeExport(files, batch);
  expect(batch.written).toBe(4);
  expect(close.mock.calls.map(([name]) => name.slice(-6))).toEqual(["-A.seq", "-B.seq", "-C.seq", "-C.seq", "-D.seq"]);
  expect(files.getDirectoryHandle).toHaveBeenCalledTimes(1);
  expect(createExport(batch.files).name).not.toBe(batch.name);
});


it("allows a retry of its own empty placeholder after a failed first save", async () => {
  const { files, contents, close } = folder();
  const project = createProject();
  const name = "banco.acidlab.json";
  close.mockRejectedValueOnce(new Error("disk"));
  await expect(writeProject(files, name, project, null, unlocked)).rejects.toThrow("disk");
  expect(contents.get(name)?.size).toBe(0);
  await writeProject(files, name, project, null, unlocked);
  expect(await contents.get(name)?.text()).toBe(projectText(project));
});

it("preserves visible external content even when the original save left a placeholder", async () => {
  const { files, contents, close } = folder();
  const project = createProject();
  const name = "banco.acidlab.json";
  close.mockRejectedValueOnce(new Error("disk"));
  await expect(writeProject(files, name, project, null, unlocked)).rejects.toThrow("disk");
  contents.set(name, new File(["externo"], name));
  await expect(writeProject(files, name, project, null, unlocked)).rejects.toThrow("Guardar como");
  expect(await contents.get(name)?.text()).toBe("externo");
});
