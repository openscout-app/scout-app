import { Pencil } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { api } from "../../lib/api.ts";
import { SESSION_NAME_MAX_LENGTH, type SessionNameSetBody, type SessionNameSetResult } from "../../../shared/api/session-names.ts";

/*
 * A session's name, renamed in place. Click the name (or its pencil) to edit:
 * Enter saves, Escape cancels, blur saves, and an empty name clears the
 * operator's name so the session shows its work title or the harness's own.
 * The runtime keeps the name; this only asks it to change and shows the
 * result until the next board read carries it.
 */

/** What a committed draft asks for: nothing, a new name, or the operator's name removed. */
export type SessionNameEdit = { kind: "unchanged" } | { kind: "set"; name: string } | { kind: "clear" };

/** The runtime counts code points, not UTF-16 code units. */
export function limitSessionName(value: string): string {
  return [...value].slice(0, SESSION_NAME_MAX_LENGTH).join("");
}

/** Read a draft as the runtime will: whitespace collapsed, empty is a clear. */
export function sessionNameEdit(draft: string, current: string, named: boolean): SessionNameEdit {
  const name = draft.replace(/\s+/gu, " ").trim();
  if (!name) return named ? { kind: "clear" } : { kind: "unchanged" };
  if (name === current.trim()) return { kind: "unchanged" };
  return { kind: "set", name: limitSessionName(name) };
}

/** Enter and Escape settle the field except while an input method is composing. */
export function sessionNameKeyAction(key: string, composing: boolean): "commit" | "cancel" | null {
  if (composing) return null;
  if (key === "Enter") return "commit";
  if (key === "Escape") return "cancel";
  return null;
}

/** Ask the runtime to set or clear one session's name. */
export function saveSessionName(body: SessionNameSetBody): Promise<SessionNameSetResult> {
  return api<SessionNameSetResult>("/api/session-names", { method: "POST", body: JSON.stringify(body) });
}

export function useSessionNameFieldController(value: string, onCommit: (draft: string) => void, onCancel: () => void) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  const settled = useRef(false);
  const composing = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const settle = (commit: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (commit) onCommit(draft); else onCancel();
  };
  const change = (event: ChangeEvent<HTMLInputElement>) => setDraft(limitSessionName(event.target.value));
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    const action = sessionNameKeyAction(
      event.key,
      composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229,
    );
    if (!action) return;
    event.preventDefault();
    settle(action === "commit");
  };
  return {
    ref,
    draft,
    change,
    keyDown,
    compositionStart: () => { composing.current = true; },
    compositionEnd: () => { composing.current = false; },
    blur: () => settle(true),
  };
}

/** The edit field alone, for any list or header that renames a session in place. */
export function SessionNameField({ value, onCommit, onCancel, className }: {
  value: string;
  onCommit: (draft: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const field = useSessionNameFieldController(value, onCommit, onCancel);
  return <input ref={field.ref} className={className ?? "s-session-name-field"} value={field.draft} spellCheck={false}
    aria-label="Session name" placeholder="Name this session"
    onChange={field.change}
    onKeyDown={field.keyDown}
    onCompositionStart={field.compositionStart}
    onCompositionEnd={field.compositionEnd}
    onClick={(event) => event.stopPropagation()}
    onPointerDown={(event) => event.stopPropagation()}
    onBlur={field.blur} />;
}

const sessionNameSaveQueues = new Map<string, Promise<void>>();

export function useSessionNameHeading({ title, named, selector, harness, identity, onRenamed }: {
  title: string;
  named: boolean;
  selector: string;
  harness?: string | null;
  /** Full session identity, including its host when the route carries one. */
  identity: string;
  onRenamed?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveGeneration = useRef(0);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  // A new board title, or another session, replaces what this showed.
  useEffect(() => { setShown(null); }, [title, identity]);
  useEffect(() => {
    setEditing(false);
    setError(null);
    return () => { saveGeneration.current += 1; };
  }, [identity]);
  useEffect(() => () => { saveGeneration.current += 1; }, []);
  const current = shown ?? title;

  const commit = (draft: string) => {
    setEditing(false);
    const edit = sessionNameEdit(draft, current, named || shown !== null);
    if (edit.kind === "unchanged") return;
    setError(null);
    if (edit.kind === "set") setShown(edit.name);
    const generation = ++saveGeneration.current;
    const requestIdentity = identity;
    const isCurrent = () => generation === saveGeneration.current && currentIdentity.current === requestIdentity;
    // Serialize writes per session even when the component that started one unmounts.
    const request = (sessionNameSaveQueues.get(identity) ?? Promise.resolve())
      .then(() => saveSessionName({ selector, ...(harness ? { harness } : {}), name: edit.kind === "set" ? edit.name : null }));
    const tail = request.then(() => undefined, () => undefined);
    sessionNameSaveQueues.set(identity, tail);
    void tail.then(() => {
      if (sessionNameSaveQueues.get(identity) === tail) sessionNameSaveQueues.delete(identity);
    });
    void request
      .then((result) => {
        if (!isCurrent()) return;
        // A cleared name falls back to work or harness titles the board knows how to show; let its read decide.
        setShown(result.resolution.source === "operator" ? result.resolution.name : null);
        onRenamed?.();
      })
      .catch((caught: unknown) => {
        if (!isCurrent()) return;
        setShown(null);
        setError(caught instanceof Error ? caught.message : "The name was not saved.");
      });
  };
  return { current, editing, error, commit, begin: () => setEditing(true), cancel: () => setEditing(false) };
}

/**
 * The session page's name. `named` says the operator named it (so an empty
 * draft clears that name); `editable` is false for a session another host
 * keeps, whose names live on that host.
 */
export function SessionNameHeading({ title, named, selector, harness, identity, editable, onRenamed }: {
  title: string;
  named: boolean;
  selector: string;
  harness?: string | null;
  identity: string;
  editable: boolean;
  onRenamed?: () => void;
}) {
  const state = useSessionNameHeading({ title, named, selector, harness, identity, onRenamed });
  if (state.editing) {
    return <h2 className="s-session-name is-editing">
      <SessionNameField value={state.current} onCommit={state.commit} onCancel={state.cancel} />
    </h2>;
  }
  if (!editable) return <h2>{state.current}</h2>;
  return <h2 className="s-session-name">
    <button type="button" className="s-session-name-button" title="Rename this session" onClick={state.begin}>
      <span>{state.current}</span>
      <Pencil size={12} aria-hidden className="s-session-name-pencil" />
    </button>
    {state.error && <span role="alert" className="s-session-name-error" title={state.error}>Not renamed: {state.error}</span>}
  </h2>;
}
