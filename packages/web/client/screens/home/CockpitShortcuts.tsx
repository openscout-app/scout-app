import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type MouseEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { routePath } from "../../lib/router.ts";
import type { Route } from "../../lib/types.ts";
import {
  COCKPIT_SHORTCUTS_MAX,
  cockpitShortcuts,
  parseShortcutLink,
  shortcutRoute,
  suggestShortcutName,
  useCockpitShortcuts,
  type CockpitShortcut,
} from "./cockpit-shortcuts.ts";
import { readRecentPages } from "./recent-pages.ts";

/*
 * The operator's shortcuts, as a row under the cockpit's head (with none yet,
 * only an Add button in the head itself): each a named
 * link into Scout (cockpit-shortcuts.ts). A plain click opens it in place, as
 * the app's own links do; a modified click is the browser's (a new tab).
 *
 * Add opens the editor on its link field; Edit opens it on the list. The
 * editor adds from a pasted link or path, or from a page this tab opened,
 * renames in place, moves a shortcut earlier or later, and removes one.
 * ⌘K › "Add this page to shortcuts" adds the page on screen from anywhere.
 */

type Opened = "add" | "edit" | null;

export function CockpitShortcuts({
  route,
  navigate,
  place = "row",
}: {
  route: Route;
  navigate: (route: Route) => void;
  /** "head": no shortcuts yet, so only Add, in the cockpit's head; "row": the band. */
  place?: "row" | "head";
}) {
  const shortcuts = useCockpitShortcuts();
  const here = routePath(route);
  const [opened, setOpened] = useState<Opened>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);

  const open = (which: Exclude<Opened, null>) => setOpened((now) => (now === which ? null : which));
  const close = useCallback((refocus: boolean) => {
    setOpened(null);
    if (refocus) addButton.current?.focus();
  }, []);

  const go = (e: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(shortcutRoute(href));
  };

  const editor = opened && (
    <ShortcutsEditor
      anchor={(opened === "edit" ? editButton.current : null) ?? addButton.current}
      startOn={opened}
      shortcuts={shortcuts}
      onClose={close}
    />
  );

  // With none saved, an empty band said "None yet" on every visit; the way in
  // is one button in the head until there is something to show.
  if (place === "head") {
    return (
      <>
        <button
          ref={addButton}
          type="button"
          className="vw-cockpit-tool vw-cockpit-tool--head"
          data-shortcuts-trigger=""
          aria-haspopup="dialog"
          aria-expanded={opened === "add"}
          onClick={() => open("add")}
          title="Add a session, an agent or a filtered page you go back to"
        >
          <Plus size={11} aria-hidden="true" />
          Add shortcut
        </button>
        {editor}
      </>
    );
  }

  return (
    <div className="vw-cockpit-row vw-cockpit-shortcuts">
      <span className="vw-cockpit-label">Shortcuts</span>
      {shortcuts.length > 0 ? (
        <nav className="vw-cockpit-shortcut-list" aria-label="Shortcuts">
          {shortcuts.map((s) => (
            <a
              key={s.id}
              href={s.href}
              className="vw-cockpit-shortcut"
              aria-current={s.href === here ? "page" : undefined}
              title={s.href}
              onClick={(e) => go(e, s.href)}
            >
              <span className="vw-cockpit-shortcut-name">{s.name}</span>
            </a>
          ))}
        </nav>
      ) : (
        <span className="vw-cockpit-shortcuts-empty">
          None yet<span className="vw-cockpit-shortcuts-hint">: add a session, an agent or a filtered page you go back to</span>
        </span>
      )}
      <span className="vw-cockpit-shortcut-tools">
        <button
          ref={addButton}
          type="button"
          className="vw-cockpit-tool"
          data-shortcuts-trigger=""
          aria-haspopup="dialog"
          aria-expanded={opened === "add"}
          onClick={() => open("add")}
          title="Add a shortcut"
        >
          <Plus size={11} aria-hidden="true" />
          Add
        </button>
        {shortcuts.length > 0 && (
          <button
            ref={editButton}
            type="button"
            className="vw-cockpit-tool"
            data-shortcuts-trigger=""
            aria-haspopup="dialog"
            aria-expanded={opened === "edit"}
            onClick={() => open("edit")}
            title="Rename, reorder or remove shortcuts"
          >
            Edit
          </button>
        )}
      </span>
      {editor}
    </div>
  );
}

// ── The editor ─────────────────────────────────────────────────────────────

type Placement = { top: number; right: number; maxHeight: number };

function ShortcutsEditor({
  anchor,
  startOn,
  shortcuts,
  onClose,
}: {
  anchor: HTMLElement | null;
  startOn: "add" | "edit";
  shortcuts: readonly CockpitShortcut[];
  onClose: (refocus: boolean) => void;
}) {
  const pop = useRef<HTMLDivElement>(null);
  const linkField = useRef<HTMLInputElement>(null);
  const listHead = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<Placement | null>(null);
  const titleId = useId();

  // fixed under its button, kept there as the page scrolls or the window resizes
  const place = useCallback(() => {
    const r = anchor?.getBoundingClientRect();
    if (!r) return;
    const top = Math.round(r.bottom + 4);
    setAt({ top, right: Math.max(8, Math.round(window.innerWidth - r.right)), maxHeight: Math.max(160, window.innerHeight - top - 8) });
  }, [anchor]);
  useLayoutEffect(place, [place]);

  useEffect(() => {
    const outside = (e: PointerEvent) => {
      const t = e.target;
      if (t instanceof Element && (pop.current?.contains(t) || t.closest("[data-shortcuts-trigger]"))) return;
      onClose(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // an emptied name takes Escape back to what it was first
      if (e.target instanceof HTMLElement && e.target.dataset.dirty === "true") return;
      e.stopPropagation();
      e.preventDefault();
      onClose(true);
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [onClose, place]);

  // focus goes to the section it opened on, once per opening (Add, then Edit, moves it)
  const focusedOn = useRef<string | null>(null);
  useEffect(() => {
    if (!at || focusedOn.current === startOn) return;
    focusedOn.current = startOn;
    (startOn === "add" ? linkField.current : listHead.current)?.focus();
  }, [at, startOn]);

  if (!at) return null;
  return createPortal(
    <div
      ref={pop}
      className="vw-cockpit-editor"
      role="dialog"
      aria-labelledby={titleId}
      style={{ top: at.top, right: at.right, maxHeight: at.maxHeight }}
    >
      <AddShortcut titleId={titleId} linkField={linkField} shortcuts={shortcuts} />
      <OpenedPages shortcuts={shortcuts} />
      <div className="vw-cockpit-editor-section">
        <div ref={listHead} className="vw-cockpit-editor-head" tabIndex={-1}>
          <span>Your shortcuts</span>
          <span className="vw-cockpit-editor-count">
            {shortcuts.length} of {COCKPIT_SHORTCUTS_MAX}
          </span>
        </div>
        {shortcuts.length === 0 ? (
          <p className="vw-cockpit-editor-note">None yet. They show in the cockpit in this order, and stay in this browser.</p>
        ) : (
          <ol className="vw-cockpit-editor-list">
            {shortcuts.map((s, i) => (
              <ShortcutRow key={s.id} shortcut={s} first={i === 0} last={i === shortcuts.length - 1} />
            ))}
          </ol>
        )}
      </div>
    </div>,
    document.body,
  );
}

function addMessage(result: ReturnType<typeof cockpitShortcuts.add>, name: string): string {
  if (result === "added") return `Added ${name}.`;
  if (result === "exists") return "That page is already a shortcut.";
  return `You have ${COCKPIT_SHORTCUTS_MAX} shortcuts, the most the cockpit keeps. Remove one to add another.`;
}

function AddShortcut({
  titleId,
  linkField,
  shortcuts,
}: {
  titleId: string;
  linkField: RefObject<HTMLInputElement | null>;
  shortcuts: readonly CockpitShortcut[];
}) {
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const linkId = useId();
  const nameId = useId();
  const noteId = useId();

  const parsed = link.trim() ? parseShortcutLink(link, window.location.origin) : null;
  const suggestion = parsed && "route" in parsed ? suggestShortcutName(parsed.route) : "";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = parseShortcutLink(link, window.location.origin);
    if ("error" in result) {
      setNote({ text: result.error, error: true });
      linkField.current?.focus();
      return;
    }
    const finalName = name.trim() || suggestShortcutName(result.route);
    const added = cockpitShortcuts.add({ name: finalName, href: result.href });
    setNote({ text: addMessage(added, finalName), error: added !== "added" });
    if (added === "added") {
      setLink("");
      setName("");
      linkField.current?.focus();
    }
  };

  return (
    <form className="vw-cockpit-editor-section" onSubmit={submit} noValidate>
      <div className="vw-cockpit-editor-head">
        <span id={titleId}>Add a shortcut</span>
      </div>
      <label className="vw-cockpit-field" htmlFor={linkId}>
        <span className="vw-cockpit-field-label">Link</span>
        <input
          ref={linkField}
          id={linkId}
          className="vw-cockpit-input"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="/sessions/… or a Scout link"
          value={link}
          aria-describedby={note ? noteId : undefined}
          aria-invalid={note?.error ? true : undefined}
          onChange={(e) => {
            setLink(e.target.value);
            setNote(null);
          }}
        />
      </label>
      <label className="vw-cockpit-field" htmlFor={nameId}>
        <span className="vw-cockpit-field-label">Name</span>
        <input
          id={nameId}
          className="vw-cockpit-input"
          type="text"
          autoComplete="off"
          maxLength={48}
          placeholder={suggestion || "Named after the page"}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="vw-cockpit-editor-actions">
        <span id={noteId} className={`vw-cockpit-editor-note${note?.error ? " is-error" : ""}`} role="status" aria-live="polite">
          {note?.text ?? (shortcuts.length >= COCKPIT_SHORTCUTS_MAX ? addMessage("full", "") : "")}
        </span>
        <button type="submit" className="vw-cockpit-tool vw-cockpit-tool--primary" disabled={!link.trim()}>
          Add
        </button>
      </div>
    </form>
  );
}

/** The pages this tab opened, newest first, that are not shortcuts yet: one click each. */
function OpenedPages({ shortcuts }: { shortcuts: readonly CockpitShortcut[] }) {
  const [pages] = useState(readRecentPages);
  const saved = new Set(shortcuts.map((s) => s.href));
  const offered = pages.filter((href) => href !== "/" && !saved.has(href)).slice(0, 5);
  if (offered.length === 0) return null;
  return (
    <div className="vw-cockpit-editor-section">
      <div className="vw-cockpit-editor-head">
        <span>Pages you opened</span>
      </div>
      <ul className="vw-cockpit-editor-list">
        {offered.map((href) => {
          const name = suggestShortcutName(shortcutRoute(href));
          return (
            <li key={href} className="vw-cockpit-editor-row">
              <span className="vw-cockpit-editor-name" title={name}>
                {name}
              </span>
              <span className="vw-cockpit-editor-href" title={href}>
                {href}
              </span>
              <button
                type="button"
                className="vw-cockpit-tool"
                onClick={() => cockpitShortcuts.add({ name, href })}
                aria-label={`Add ${name} to shortcuts`}
              >
                <Plus size={11} aria-hidden="true" />
                Add
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ShortcutRow({ shortcut, first, last }: { shortcut: CockpitShortcut; first: boolean; last: boolean }) {
  // The name saves as it is typed, so closing the editor never drops an edit.
  // An emptied field keeps the old name, and shows it again on leaving.
  const [draft, setDraft] = useState(shortcut.name);
  useEffect(() => setDraft(shortcut.name), [shortcut.name]);
  const emptied = draft.trim() === "";
  return (
    <li className="vw-cockpit-editor-row">
      <input
        className="vw-cockpit-input vw-cockpit-editor-rename"
        type="text"
        value={draft}
        maxLength={48}
        aria-label={`Name of the shortcut to ${shortcut.href}`}
        data-dirty={emptied ? "true" : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          if (e.target.value.trim()) cockpitShortcuts.rename(shortcut.id, e.target.value);
        }}
        onBlur={() => emptied && setDraft(shortcut.name)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape" && emptied) {
            e.preventDefault();
            setDraft(shortcut.name);
          }
        }}
      />
      <span className="vw-cockpit-editor-href" title={shortcut.href}>
        {shortcut.href}
      </span>
      <span className="vw-cockpit-editor-tools">
        <button
          type="button"
          className="vw-cockpit-icon"
          disabled={first}
          onClick={() => cockpitShortcuts.move(shortcut.id, -1)}
          aria-label={`Move ${shortcut.name} earlier`}
          title="Move earlier"
        >
          <ArrowUp size={11} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="vw-cockpit-icon"
          disabled={last}
          onClick={() => cockpitShortcuts.move(shortcut.id, 1)}
          aria-label={`Move ${shortcut.name} later`}
          title="Move later"
        >
          <ArrowDown size={11} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="vw-cockpit-tool"
          onClick={() => cockpitShortcuts.remove(shortcut.id)}
          aria-label={`Remove ${shortcut.name}`}
        >
          Remove
        </button>
      </span>
    </li>
  );
}
