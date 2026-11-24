import { useEffect, useRef, useState } from "preact/hooks";
import { createHistory, commitHistory, moveHistory, newId, projectText, type Project } from "./project";
import { putDraft, type Draft, type DraftRevision } from "./project-storage";
import type { FileTarget } from "./project-files";

interface Session {
  id: string;
  baseline: string;
  target: FileTarget | null;
  previous?: DraftRevision[];
}

export function useProject(initial: () => Project) {
  const [history, setHistory] = useState(() => createHistory(initial()));
  const [session, setSession] = useState<Session>(() => ({
    id: newId(), baseline: projectText(history.current), target: null,
  }));
  const [durable, setDurable] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState(false);
  const current = history.current;
  const serialized = projectText(current);
  const dirty = serialized !== session.baseline;
  const recoverable = durable?.session === session.id && projectText(durable.project) === serialized;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const hadDraft = useRef(new Set<string>());

  function persist(project: Project, origin: Session): Promise<unknown> {
    const draft: Draft = {
      project, baseline: origin.baseline, session: origin.id, updated: Date.now(),
      ...(origin.target ? { target: origin.target } : {}),
      ...(origin.previous ? { previous: origin.previous } : {}),
    };
    hadDraft.current.add(origin.id);
    const pending = queue.current.then(() => putDraft(draft));
    queue.current = pending.catch(() => {});
    return pending.then(() => {
      setDurable(draft);
      setDraftError(false);
    }, (error: unknown) => {
      setDraftError(true);
      throw error;
    });
  }

  useEffect(() => {
    if (dirty || hadDraft.current.has(session.id)) {
      const timer = setTimeout(() => { void persist(current, session).catch(() => {}); }, 320);
      return () => clearTimeout(timer);
    }
  }, [current, session, dirty]);

  function commit(change: (project: Project) => Project, label: string) {
    setHistory((value) => commitHistory(value, change(value.current), label));
  }

  function move(direction: "undo" | "redo") {
    setHistory((value) => moveHistory(value, direction));
  }

  // Persiste la revisión que se está dejando antes de reemplazar la sesión.
  async function open(project: Project, target: FileTarget | null, canReplace: () => boolean, draft?: Draft) {
    if (dirty || hadDraft.current.has(session.id)) await persist(current, session);
    const id = newId();
    const baseline = draft?.baseline ?? projectText(project);
    // Un borrador conserva la huella de su archivo original, aunque otra pestaña haya guardado.
    const next: Session = {
      id, target: draft?.target ?? target, baseline,
      ...(draft ? { previous: [...draft.previous ?? [], { session: draft.session, updated: draft.updated }] } : {}),
    };
    if (draft && projectText(project) !== next.baseline) {
      if (!canReplace()) return false;
      await persist(project, next);
    }
    if (!canReplace()) return false;
    setHistory(createHistory(project));
    setSession(next);
    setDraftError(false);
    return true;
  }

  function markSaved(project: Project, target: FileTarget) {
    setSession((origin) => origin.id === session.id ? { ...origin, baseline: projectText(project), target } : origin);
  }

  return { history, current, sessionId: session.id, dirty, recoverable, draftError, target: session.target, commit, move, open, markSaved };
}
