/**
 * The space switcher: which room-set you are in, and how to make another.
 *
 * It sits above the channel list because that is what it governs — the list
 * below it is this space's channels and nothing else. It is deliberately the
 * quietest control in the column: a name, a caret, and a menu. A space is
 * changed rarely, so it earns one line, not a rail of its own.
 *
 * Nothing here is inferred. The list comes off `/api/chat/bootstrap`; a space
 * the server did not send is not drawn, and the count beside each name is the
 * server's count of the channels this viewer can see in it. When the server
 * sends one space, the switcher renders as a plain label rather than as a menu
 * that opens onto a single choice.
 *
 * Creating a space creates its first channel with it. A space with no room in
 * it is a dead end the operator has to notice and fix, so the form asks for
 * both and the server defaults the second to `general`.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { ChatSpaceView } from "./chat-api.ts";
import { useChatCapabilities } from "./chat-transport.tsx";
import { SpaceMark } from "./SpaceMark.tsx";

export function SpaceSwitcher({
  spaces,
  activeSlug,
  canCreate,
  railed,
  onSelect,
  onCreate,
  onDelete,
  accessHref,
  onExpandRail,
  variant = "menu",
}: {
  spaces: ChatSpaceView[];
  activeSlug: string;
  canCreate: boolean;
  railed: boolean;
  onSelect: (slug: string) => void;
  onCreate: (input: { title: string; channel: string }) => Promise<void>;
  /** Absent where the server has no deletion endpoint; the item is not drawn. */
  onDelete: ((slug: string) => Promise<void>) | null;
  accessHref?: string;
  onExpandRail: () => void;
  /**
   * `menu`: the current space's name, opening onto every space. `add`: the
   * strip's trailing +, where the strip's tabs already list the spaces, so its
   * menu holds only New space and Delete.
   */
  variant?: "menu" | "add";
}) {
  const capabilities = useChatCapabilities();
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [channel, setChannel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Deleting a space is irreversible, so it is armed by name rather than by a
  // single click: the item asks, and the second press is the one that acts.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const active = spaces.find((space) => space.slug === activeSlug)
    ?? spaces[0]
    ?? null;

  // Closing the menu disarms the confirmation; a menu reopened later must not
  // still be one click away from deleting something.
  useEffect(() => {
    if (!menuOpen) setConfirmingDelete(false);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  const submit = useCallback(async () => {
    const name = title.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({ title: name, channel: channel.trim() });
      setTitle("");
      setChannel("");
      setCreating(false);
      setMenuOpen(false);
    } catch (cause) {
      // The server owns the refusal — a duplicate slug, a name with no usable
      // slug in it. Rendered verbatim rather than replaced with a guess.
      setError(cause instanceof Error ? cause.message : "That space could not be created.");
    } finally {
      setBusy(false);
    }
  }, [busy, channel, onCreate, title]);

  if (!active) return null;

  if (railed) {
    return (
      <div className="chat-space-switch" data-railed="true" ref={rootRef}>
        <button
          type="button"
          className="chat-rail-row chat-space-rail"
          aria-label={`${active.title} — switch space`}
          title={active.title}
          onClick={() => onExpandRail()}
        >
          <SpaceMark slug={active.slug} size={20} />
        </button>
      </div>
    );
  }

  // One space is not a choice. Drawing a menu for it would promise somewhere
  // else to go and then open onto the room you are already in.
  // Keep this menu available in the native app too: access management and
  // deletion are web actions, even when the native sidebar lists spaces.
  const add = variant === "add";
  const switchable = add
    ? canCreate || Boolean(accessHref) || (onDelete !== null && capabilities.spaceDelete)
    : spaces.length > 1 || Boolean(accessHref) || canCreate;
  if (add && !switchable) return null;

  return (
    <div className="chat-space-switch" data-variant={variant} ref={rootRef}>
      <button
        type="button"
        className={add ? "chat-space-add" : "chat-space-current"}
        aria-label={add ? "New space" : undefined}
        title={add ? "New space" : undefined}
        aria-expanded={switchable ? menuOpen : undefined}
        aria-haspopup={switchable ? "menu" : undefined}
        disabled={!switchable}
        onClick={() => switchable && setMenuOpen((open) => !open)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && menuOpen) {
            event.preventDefault();
            event.stopPropagation();
            setMenuOpen(false);
          }
        }}
      >
        {add ? (
          <span aria-hidden="true">+</span>
        ) : (
          <>
            <SpaceMark slug={active.slug} />
            <span className="chat-space-name">{active.title}</span>
            {switchable ? (
              <span className="chat-space-caret" aria-hidden="true">{menuOpen ? "⌄" : "⌃"}</span>
            ) : null}
          </>
        )}
      </button>

      {menuOpen ? (
        <div className="chat-space-menu" role="menu" aria-label="Spaces">
          {add ? null : spaces.map((space) => (
            <button
              key={space.slug}
              type="button"
              role="menuitemradio"
              aria-checked={space.slug === active.slug}
              className="chat-space-menu-item"
              data-active={space.slug === active.slug}
              onClick={() => {
                setMenuOpen(false);
                if (space.slug !== active.slug) onSelect(space.slug);
              }}
            >
              <SpaceMark slug={space.slug} size={16} />
              <span className="chat-space-menu-name">{space.title}</span>
              {/* A server that does not count another space's channels gets no
                  number here, rather than a zero that reads as "empty". */}
              {space.channelCount === undefined ? null : (
                <span className="label-sm chat-space-menu-count">
                  {space.channelCount}
                </span>
              )}
            </button>
          ))}

          {canCreate ? (
            <>
              {add ? null : <div className="chat-space-menu-rule" />}
              {creating ? (
                <div className="chat-create-form">
                  <input
                    className="chat-input"
                    value={title}
                    autoFocus
                    placeholder="Space name"
                    aria-label="Space name"
                    onChange={(event) => setTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void submit();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        setCreating(false);
                      }
                    }}
                  />
                  {/* Offered only where the server honors it. Where the server
                      names the first channel itself, a field whose value is
                      discarded is worse than no field. */}
                  {capabilities.namedFirstChannel ? (
                    <input
                      className="chat-input"
                      value={channel}
                      placeholder="First channel (general)"
                      aria-label="First channel"
                      onChange={(event) => setChannel(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void submit();
                        }
                      }}
                    />
                  ) : null}
                  {error ? <p className="chat-space-error">{error}</p> : null}
                  <div className="chat-create-actions">
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={busy || !title.trim()}
                      onClick={() => void submit()}
                    >
                      {busy ? "Creating…" : "Create"}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setCreating(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="chat-space-menu-item chat-space-menu-new"
                  onClick={() => setCreating(true)}
                >
                  + New space
                </button>
              )}
            </>
          ) : null}

          {accessHref ? <a className="chat-space-menu-item" role="menuitem" href={accessHref}>Space access</a> : null}

          {onDelete && capabilities.spaceDelete ? (
            <>
              {add && !canCreate ? null : <div className="chat-space-menu-rule" />}
              <button
                type="button"
                className="chat-space-menu-item chat-space-menu-danger"
                disabled={busy}
                onClick={() => {
                  if (!confirmingDelete) {
                    setConfirmingDelete(true);
                    return;
                  }
                  setBusy(true);
                  setError(null);
                  void onDelete(active.slug)
                    .then(() => {
                      setConfirmingDelete(false);
                      setMenuOpen(false);
                    })
                    .catch((cause: unknown) => {
                      setConfirmingDelete(false);
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "That space could not be deleted.",
                      );
                    })
                    .finally(() => setBusy(false));
                }}
              >
                {confirmingDelete
                  ? `Delete ${active.title} and everything in it`
                  : "Delete this space"}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Spaces as tabs, once there is more than one: an editor-style strip over the
 * rooms page, in the shell's page band, so it spans the list in the side rail
 * and the room beside it, the two things a space scopes. The open space's tab
 * is cut out of the line under the strip and carries the accent on its top
 * edge. Names only: the server sends no per-space unread count, so the tabs
 * claim none. The trailing + is New space, and Delete for the open one.
 */
export function SpaceStrip({
  spaces,
  activeSlug,
  canCreate,
  onSelect,
  onCreate,
  onDelete,
}: {
  spaces: ChatSpaceView[];
  activeSlug: string;
  canCreate: boolean;
  onSelect: (slug: string) => void;
  onCreate: (input: { title: string; channel: string }) => Promise<void>;
  onDelete: ((slug: string) => Promise<void>) | null;
}) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(0, spaces.findIndex((space) => space.slug === activeSlug));
  return (
    <div className="chat-space-strip">
      <div className="chat-space-tabs" role="tablist" aria-label="Spaces">
        {spaces.map((space, index) => {
          const on = index === activeIndex;
          return (
            <button
              key={space.slug}
              ref={(element) => { tabs.current[index] = element; }}
              type="button"
              role="tab"
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              className="chat-space-tab"
              data-active={on ? "true" : undefined}
              title={space.title}
              onClick={() => { if (!on) onSelect(space.slug); }}
              onKeyDown={(event) => {
                // Arrows move between tabs, as in any tablist; Enter or Space opens one.
                const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                if (!step) return;
                event.preventDefault();
                tabs.current[(index + step + spaces.length) % spaces.length]?.focus();
              }}
            >
              <SpaceMark slug={space.slug} size={16} />
              {space.title}
            </button>
          );
        })}
      </div>
      <SpaceSwitcher
        variant="add"
        spaces={spaces}
        activeSlug={activeSlug}
        canCreate={canCreate}
        railed={false}
        onSelect={onSelect}
        onCreate={onCreate}
        onDelete={onDelete}
        onExpandRail={() => {}}
      />
      <span className="chat-space-strip-rest" aria-hidden="true" />
    </div>
  );
}
