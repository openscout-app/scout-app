/**
 * Top-row actions: Search and New chat.
 *
 * Both are things you do from anywhere, not places, so they sit in the app
 * frame's top row rather than at the head of the sidebar's list of places:
 * Search at the centre of the window, New chat beside the operator. Search is
 * a field: names and pasted IDs resolve in place (OmniSearch.tsx). New chat opens the same composer as its shortcut. The Slack presentation and
 * builds without this row keep them in the sidebar.
 */
import { PlusGlyph } from "../../components/ScoutGlyph.tsx";
import { NEW_CHAT_SHORTCUT_LABEL, NEW_TASK_ACTION_LABEL } from "../../lib/new-chat-shortcut.ts";
import { OmniSearch } from "./OmniSearch.tsx";
import "./top-row-actions.css";

export function TopRowActions({
  searchActive,
  onNewChat,
}: {
  searchActive: boolean;
  onNewChat: () => void;
}) {
  return (
    <span className="scout-top-row-actions" role="group" aria-label="Actions">
      <OmniSearch searchActive={searchActive} />
      <button
        type="button"
        className="scout-top-row-new"
        data-action="new-task"
        aria-label={NEW_TASK_ACTION_LABEL}
        aria-keyshortcuts={NEW_CHAT_SHORTCUT_LABEL}
        title={`${NEW_TASK_ACTION_LABEL} (${NEW_CHAT_SHORTCUT_LABEL})`}
        onClick={onNewChat}
      >
        <PlusGlyph size={15} aria-hidden="true" />
      </button>
    </span>
  );
}
