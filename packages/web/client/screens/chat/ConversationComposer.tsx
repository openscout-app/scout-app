import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { motion, useReducedMotion } from "motion/react";
import type { PendingQueueDraft } from "./use-queue-continuity.ts";
import { Pencil, Reply, X, Zap } from "lucide-react";
import { actorColor } from "../../lib/colors.ts";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import {
  ComposerAttachmentStrip,
  MessageComposer,
  MessageComposerSuggestions,
  type ComposerAttachmentsState,
} from "../../components/MessageComposer/index.ts";
import type {
  BusySendIntent,
  ComposeAction,
  MentionCandidate,
  MentionSuggestState,
  QueuedDraft,
  SlashCommand,
  SlashSuggestState,
} from "./conversation-model.ts";
import { useThreadDropTarget } from "../../scout/thread-drop-target.ts";

export type ConversationReplyTarget = {
  messageId: string;
  actorLabel: string;
  preview: string;
  insertedMention?: string | null;
};

export function ConversationComposer({
  session = false,
  agentName = "agent",
  runtimeLabel,
  composeRef,
  draft,
  setDraft,
  composePlaceholder,
  slashState,
  setSlashState,
  filteredSlashCommands,
  applySlashCommand,
  mentionState,
  setMentionState,
  filteredMentions,
  applyMention,
  updateTriggersFromDraft,
  closeSuggestions,
  replyTarget,
  onCancelReply,
  isStopMode,
  sending,
  composeAction,
  onSend,
  onInterrupt,
  attachments,
  isAgentBusy,
  busyIntent,
  onBusyIntentChange,
  queued,
  pendingQueue,
  queueReceipt,
  queueNote,
  onEditQueued,
  editingQueuedId,
  editingAttachmentCount,
  onCancelEdit,
  onUnqueue,
  onSendQueuedNow,
}: {
  session?: boolean;
  agentName?: string;
  runtimeLabel?: string;
  composeRef: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  composePlaceholder: string;
  slashState: SlashSuggestState;
  setSlashState: Dispatch<SetStateAction<SlashSuggestState>>;
  filteredSlashCommands: SlashCommand[];
  applySlashCommand: (command: SlashCommand) => void;
  mentionState: MentionSuggestState;
  setMentionState: Dispatch<SetStateAction<MentionSuggestState>>;
  filteredMentions: MentionCandidate[];
  applyMention: (candidate: MentionCandidate) => void;
  updateTriggersFromDraft: (value: string, caret: number) => void;
  closeSuggestions: () => void;
  replyTarget: ConversationReplyTarget | null;
  onCancelReply: () => void;
  isStopMode: boolean;
  sending: boolean;
  composeAction: ComposeAction;
  onSend: () => void;
  onInterrupt: () => void;
  attachments: ComposerAttachmentsState;
  isAgentBusy: boolean;
  /** What the next Send press does while the agent is mid-turn. */
  busyIntent: BusySendIntent;
  onBusyIntentChange: (intent: BusySendIntent) => void;
  queued: readonly QueuedDraft[];
  pendingQueue?: PendingQueueDraft | null;
  queueReceipt?: string | null;
  queueNote: string | null;
  /** Pull a queued draft back into the input box to rewrite it. */
  onEditQueued: (id: string) => void;
  /** The queued draft currently held in the input box, if any. */
  editingQueuedId: string | null;
  /** Files already uploaded for the draft being rewritten; they ride along. */
  editingAttachmentCount: number;
  /** Abandon the rewrite and leave the queued row as it was. */
  onCancelEdit: () => void;
  onUnqueue: (id: string) => void;
  /** Interrupt the running turn and release one queued draft immediately. */
  onSendQueuedNow: (id: string) => void;
}) {
  const reduceMotion = useReducedMotion();
  const visibleQueued = [...queued];
  if (pendingQueue && !visibleQueued.some((entry) => entry.id === pendingQueue.draft.id)) {
    visibleQueued.splice(Math.min(pendingQueue.index, visibleQueued.length), 0, pendingQueue.draft);
  }
  const overlay = (
    <>
      {slashState.open ? (
        <MessageComposerSuggestions
          label="Slash commands"
          items={filteredSlashCommands.map((command) => ({
            id: command.command,
            token: command.label,
            description: command.description,
          }))}
          activeIndex={slashState.index}
          onPick={(index) => {
            const command = filteredSlashCommands[index];
            if (command) applySlashCommand(command);
          }}
          onActiveIndexChange={(index) => setSlashState((state) => ({ ...state, index }))}
        />
      ) : null}

      {mentionState.open ? (
        <MessageComposerSuggestions
          label="Mention agent"
          items={filteredMentions.map((mention) => ({
            id: mention.id,
            token: `@${mention.handle}`,
            description: mention.name,
            avatarNode: session ? undefined : (
              <AgentAvatar
                name={mention.name}
                size={20}
                tile
                presence={false}
              />
            ),
          }))}
          activeIndex={mentionState.index}
          onPick={(index) => {
            const mention = filteredMentions[index];
            if (mention) applyMention(mention);
          }}
          onActiveIndexChange={(index) => setMentionState((state) => ({ ...state, index }))}
        />
      ) : null}
    </>
  );

  // While the agent is mid-turn a draft is ambiguous: hold it for the next turn
  // (Queue) or cut in now (Steer). Queue is the default because interrupting is
  // the destructive read of the two — Steer is armed deliberately.
  // A file dropped anywhere on the thread attaches to this message.
  useThreadDropTarget(attachments.stage);
  const hasDraft = draft.trim().length > 0;
  const isEditing = editingQueuedId !== null;
  // A rewrite counts as content even when its text is emptied, because the
  // files it carries are still going somewhere.
  const hasContent =
    hasDraft || attachments.hasFiles || editingAttachmentCount > 0;
  const queueMode = isAgentBusy && hasContent;
  const steerArmed = queueMode && (session || busyIntent === "steer");
  const editingIndex = isEditing
    ? queued.findIndex((entry) => entry.id === editingQueuedId) + 1
    : 0;

  // A modifier, not a second send: it states what the one Send button will do.
  const modeSwitch = !session && queueMode ? (
    <div
      className="s-msg-compose-mode"
      role="group"
      aria-label="What Send does while this turn is running"
    >
      <button
        type="button"
        className="s-msg-compose-mode-btn"
        data-mode="queue"
        aria-pressed={busyIntent === "queue"}
        title="Hold this draft until the running turn lands"
        disabled={sending}
        onClick={() => onBusyIntentChange("queue")}
      >
        Queue
      </button>
      <button
        type="button"
        className="s-msg-compose-mode-btn"
        data-mode="steer"
        aria-pressed={busyIntent === "steer"}
        title="Interrupt the running turn and deliver this now"
        disabled={sending}
        onClick={() => onBusyIntentChange("steer")}
      >
        Send now
      </button>
    </div>
  ) : null;

  // The queue is fused to the top of the composer box: one object, so a queued
  // draft reads as something the input box is still holding, not a separate
  // list parked above it.
  const queueStack = !session && (visibleQueued.length > 0 || modeSwitch) ? (
    <div className="s-msg-compose-queue" role="group" aria-label="Queued messages">
      <div className="s-msg-compose-queue-head">
        <span className="s-msg-compose-queue-kicker">
          {visibleQueued.length > 0 ? `Queue · ${visibleQueued.length}` : "Queues next"}
        </span>
        <span className="s-msg-compose-queue-hint">
          {isEditing
            ? steerArmed
              ? `Rewriting ${editingIndex} — send interrupts this turn`
              : `Rewriting ${editingIndex} — send returns it to its place`
            : queued.length > 0
              ? steerArmed
                ? "Send interrupts this turn"
                : (queueNote ?? "")
              : steerArmed
                ? "Interrupts this turn on send"
                : "Sends when this turn lands"}
        </span>
        {modeSwitch}
      </div>
      {visibleQueued.map((entry, index) => (
        <motion.div
          layout={reduceMotion ? false : "position"}
          initial={false}
          transition={{ duration: .18 }}
          id={`queue-draft-${entry.id}`}
          data-submitting={pendingQueue?.draft.id === entry.id || undefined}
          aria-busy={pendingQueue?.draft.id === entry.id}
          className="s-msg-compose-queue-row"
          key={entry.id}
          data-editing={entry.id === editingQueuedId ? "true" : undefined}
        >
          <span className="s-msg-compose-queue-index">{index + 1}</span>
          {pendingQueue?.draft.id === entry.id ? <span role="status">Sending…</span> : null}
          <span className="s-msg-compose-queue-body">
            {entry.body.trim() || "Attachments only"}
          </span>
          {entry.attachments.length > 0 ? (
            <span className="s-msg-compose-queue-clip">
              {entry.attachments.length} file
              {entry.attachments.length === 1 ? "" : "s"}
            </span>
          ) : null}
          {pendingQueue?.draft.id === entry.id ? null : entry.id === editingQueuedId ? (
            <button
              type="button"
              className="s-msg-compose-queue-edit btn btn--sm btn--ghost"
              title="Stop rewriting — leave this row as it was"
              aria-label={`Cancel rewriting queued message ${index + 1}`}
              onClick={onCancelEdit}
            >
              Cancel edit
            </button>
          ) : (
            <button
              type="button"
              className="s-msg-compose-queue-edit btn btn--sm btn--ghost"
              title="Pull this back into the input box to rewrite it"
              aria-label={`Edit queued message ${index + 1}`}
              disabled={sending || isEditing}
              onClick={() => onEditQueued(entry.id)}
            >
              <Pencil size={11} aria-hidden="true" />
              <span>Edit</span>
            </button>
          )}
          <button
            type="button"
            className="s-msg-compose-queue-now btn btn--sm btn--accent"
            title="Interrupt this turn and send this now"
            aria-label={`Send queued message ${index + 1} now`}
            disabled={sending || entry.id === editingQueuedId || pendingQueue?.draft.id === entry.id}
            onClick={() => onSendQueuedNow(entry.id)}
          >
            <Zap size={11} aria-hidden="true" />
            <span>Send now</span>
          </button>
          <button
            type="button"
            className="s-msg-compose-queue-drop btn btn--ghost btn--icon"
            title="Cancel — drop this from the queue"
            aria-label={`Cancel queued message ${index + 1}`}
            disabled={sending || pendingQueue?.draft.id === entry.id}
            onClick={() => onUnqueue(entry.id)}
          >
            ×
          </button>
        </motion.div>
      ))}
    </div>
  ) : null;

  return (
    <MessageComposer
      className={session && steerArmed ? "s-session-composer--armed" : undefined}
      stopAriaLabel={`Stop ${agentName}`}
      density="thread"
      value={draft}
      onChange={(next, meta) => {
        setDraft(next);
        updateTriggersFromDraft(next, meta?.caret ?? next.length);
      }}
      onSend={onSend}
      placeholder={composePlaceholder}
      sending={sending}
      stopMode={isStopMode}
      onStop={onInterrupt}
      canSend={hasContent}
      sendTitle={
        steerArmed
          ? "Send now — interrupt this turn and send now (Enter)"
          : queueMode
            ? "Queue for the next turn (Enter)"
            : "Send (Enter) · Shift+Enter for a new line"
      }
      sendAriaLabel={
        steerArmed
          ? "Send now — interrupt this turn and send now"
          : queueMode
            ? "Queue message for the next turn"
            : composeAction === "steer"
              ? "Send follow-up"
              : "Send message"
      }
      showAttach
      onAttach={attachments.openPicker}
      onPaste={attachments.onPaste}
      dropHandlers={attachments.dropHandlers}
      dragActive={attachments.dragActive}
      textareaRef={composeRef}
      overlay={overlay}
      above={queueStack}
      aboveAttached
      header={
        <>
          {queueReceipt ? <div className="scout-queue-receipt" role="status">{queueReceipt}</div> : null}
          {replyTarget ? (
            <div className="s-thread-compose-reply surface-card surface-card--inset" role="status">
              <Reply
                className="s-thread-compose-reply-icon text-muted"
                size={13}
                strokeWidth={1.8}
                aria-hidden="true"
              />
              <span className="s-thread-compose-reply-label label-xs text-muted">Replying to</span>
              <span className="s-thread-compose-reply-actor chip chip--sm chip--mono chip--neutral">
                {replyTarget.actorLabel}
              </span>
              <span
                className="s-thread-compose-reply-preview text-muted"
                title={replyTarget.preview}
              >
                {replyTarget.preview}
              </span>
              <button
                type="button"
                className="s-thread-compose-reply-cancel btn btn--ghost btn--icon"
                aria-label="Cancel reply"
                title="Cancel reply"
                onClick={onCancelReply}
              >
                <X size={13} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {isEditing && editingAttachmentCount > 0 ? (
            <div className="s-msg-compose-carried" role="status">
              {editingAttachmentCount} file
              {editingAttachmentCount === 1 ? "" : "s"} stay attached to this
              draft
            </div>
          ) : null}
          <ComposerAttachmentStrip attachments={attachments} />
        </>
      }
      tools={(
        <span className="s-thread-compose-hint s-msg-compose-tools-hint">
          {session ? <>{runtimeLabel}{steerArmed && <span className="s-session-send-hint">Sends now · interrupts {agentName}</span>}</> : <>
          <kbd className="s-kbd">/</kbd> commands
          {" · "}
          <kbd className="s-kbd">@</kbd> agents</> }
        </span>
      )}
      onSelect={(event) => {
        const target = event.currentTarget;
        updateTriggersFromDraft(target.value, target.selectionStart);
      }}
      onBlur={() => {
        setTimeout(closeSuggestions, 120);
      }}
      onKeyDown={(event) => {
        const suggestOpen =
          (slashState.open && filteredSlashCommands.length > 0)
          || (mentionState.open && filteredMentions.length > 0);
        if (!suggestOpen) return false;

        if (event.key === "ArrowDown") {
          if (slashState.open) {
            setSlashState((s) => ({
              ...s,
              index: (s.index + 1) % filteredSlashCommands.length,
            }));
          } else if (mentionState.open) {
            setMentionState((s) => ({
              ...s,
              index: (s.index + 1) % filteredMentions.length,
            }));
          }
          return true;
        }
        if (event.key === "ArrowUp") {
          if (slashState.open) {
            setSlashState((s) => ({
              ...s,
              index:
                (s.index - 1 + filteredSlashCommands.length)
                % filteredSlashCommands.length,
            }));
          } else if (mentionState.open) {
            setMentionState((s) => ({
              ...s,
              index:
                (s.index - 1 + filteredMentions.length)
                % filteredMentions.length,
            }));
          }
          return true;
        }
        if (event.key === "Escape") {
          closeSuggestions();
          return true;
        }
        if (
          (event.key === "Enter" || event.key === "Tab")
          && !event.shiftKey
          && !event.metaKey
          && !event.ctrlKey
          && !event.altKey
        ) {
          if (slashState.open) {
            const pick =
              filteredSlashCommands[slashState.index]
              ?? filteredSlashCommands[0];
            if (pick) applySlashCommand(pick);
          } else if (mentionState.open) {
            const pick =
              filteredMentions[mentionState.index] ?? filteredMentions[0];
            if (pick) applyMention(pick);
          }
          return true;
        }
        return false;
      }}
    />
  );
}
