/** Operator input, not a Scout message, ask, flight, or resumed session. */
export const SESSION_STEER_MAX_LENGTH = 32_000;

export type SessionTerminal = {
  app: string | null;
  bundleId: string | null;
  appPid: number | null;
  attached?: boolean;
  /** The window or tab title the terminal app shows for this tty, when it reports one. */
  window?: string | null;
};
export type SessionFocusResult = {
  ok: boolean;
  code: string;
  reason: string;
  target: SessionSteerTarget | null;
  precision?: "pane" | "tab" | "tty" | "app";
  selected?: boolean;
  activation?: "requested";
  nativeActivation?: { appPid: number; bundleId: string };
  attach?: string;
  /** With tmux_detached: the verified tmux session no terminal is attached to. */
  detached?: { socket: string; session: string };
};
export type SessionSteerTerminalTarget = {
  terminal?: SessionTerminal;
  pid: number;
  processStart: string;
  host: "herdr" | "orca" | "tmux" | "terminal";
  address: string;
  tty: string | null;
  /**
   * A Claude background session (`claude --bg`): its tty belongs to Claude's
   * own pty host, so no window shows it. `claude attach <id>` opens it in one.
   */
  job?: { id: string; name: string | null };
};
export type SessionSteerTarget = SessionSteerTerminalTarget | {
  host: "broker";
  endpointId: string;
  transport: string;
};
export type SessionSteerAvailability = {
  /** Independent of input permission: blocked/background sessions can still be focused. */
  focus?: { available: boolean; code: string; reason: string; attach?: string };
  available: boolean;
  code: string;
  reason: string;
  target: SessionSteerTarget | null;
};
export type SessionSteerAuditEntry = {
  id: string;
  at: string;
  operator: string;
  sessionRef: string;
  machine: string | null;
  serverHost: string;
  target: SessionSteerTarget | null;
  outcome: "accepted" | "refused" | "unconfirmed";
  code: string;
  reason: string;
  /** UTF-16 code units, as in the composer maxlength. */
  textLength: number;
  /** SHA-256 of the submitted text. Bodies are never stored in this audit. */
  textSha256: string;
  duplicateOutcomes?: number;
};
export type SessionSteerReceipt = { ok: boolean; audit: SessionSteerAuditEntry };

/**
 * POST /api/session-ref/:ref/open-terminal: a session no window shows, opened
 * in a terminal app on its attach command (`claude attach <job>`, or tmux
 * attach). That window is a pop-out: `popOut` names it for
 * POST /api/session-ref/:ref/close-terminal ({ machine, popOut }), which hangs
 * up its attach and closes it, and `terminal` is the app that drew it, when
 * it could be read. POST /api/session-ref/:ref/open-thread: a Codex thread
 * the ChatGPT app holds, opened there.
 */
export type SessionOpenPlaceResult = {
  ok: boolean;
  code: string;
  reason: string;
  app?: string;
  popOut?: string;
  terminal?: { app: string; bundleId: string; appPid: number };
};

/**
 * POST /api/session-ref/:ref/open-pane: a background session's attach,
 * started in a tmux session of Scout's own for the companion's quick
 * terminal. `pane` is what the pop-up shows; POST
 * /api/session-ref/close-terminal with `popOut` hangs the attach up.
 */
export type SessionOpenPaneResult = SessionOpenPlaceResult & {
  pane?: { backend: "tmux"; sessionName: string };
};

/**
 * Whether Scout can check a background session's pending call on its screen
 * before answering it: only a shell command, whole (core's pending-call reader
 * ends a clipped subject with "…"). Other tools keep "Open in a terminal".
 */
export function canAnswerInPlace(call: { subjectKind?: string | null; subject?: string | null } | null | undefined): boolean {
  return Boolean(call && call.subjectKind === "command" && call.subject?.trim() && !call.subject.endsWith("…"));
}

/** Which of a permission prompt's plain answers the operator chose: its Yes or its No. */
export type SessionPromptDecision = "approve" | "deny";

/**
 * POST /api/session-ref/:ref/answer-prompt ({ machine, toolUseId, decision }):
 * a Claude background session's permission prompt, answered from the card.
 * The server attaches in a hidden tmux session, presses the key only while
 * the screen shows that same call, waits for the transcript to settle it,
 * and hangs up. `sent` says whether a key went out; `answer` is the option
 * label it pressed. Any refusal with `sent: false` leaves the prompt as it was.
 */
export type SessionAnswerPromptResult = {
  ok: boolean;
  code: string;
  reason: string;
  sent: boolean;
  answer?: string;
};
