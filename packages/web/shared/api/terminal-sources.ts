/**
 * Wire shapes for where terminals run and what their harnesses call them
 * (`GET /api/terminal-places`, `GET /api/terminal-sources?refs=`).
 */

/** A live tmux or herdr session with at least one attached client. */
export type TerminalPlace = {
  backend: "tmux" | "herdr";
  sessionName: string;
  /** The apps its clients run in ("Rex", "Ghostty"), in the order found. */
  apps: string[];
  /** Attached clients, including ones whose app is unknown. */
  clients: number;
  /**
   * The Rex blocks its clients run in, in the order found: where the session
   * sits in Rex's own layout. Absent from servers that predate it.
   */
  rex?: TerminalRexPlace[];
};

/** One Rex block, placed in its window and session. Labels are null when Rex generated them. */
export type TerminalRexPlace = {
  sessionId: string;
  /** The Rex session's label ("hidden-bluff"). */
  session: string | null;
  windowId: string | null;
  /** The window's label ("core waiting"); null when Rex named it after its id. */
  window: string | null;
  /** The window's position in the session, from 1; null when the block is detached. */
  windowIndex: number | null;
  blockId: string;
  /** The block's label ("board coordinator"); null for Rex's default "shell". */
  block: string | null;
  /** The block's place in its window's layout, in reading order, from 1; null when not in the layout. */
  blockIndex: number | null;
};

export type TerminalPlacesResponse = {
  ok: true;
  /** This host's name, as the OS reports it. */
  host: string;
  /** This host's Scout node id, when the runtime answers. */
  nodeId: string | null;
  places: TerminalPlace[];
};

/** What a harness session calls itself and what it said last. */
export type TerminalSource = {
  /** The harness's own name for the session; null when every one was generated. */
  title: string | null;
  /** The first sentence of its latest answer. */
  doing: string | null;
};

export type TerminalSourcesResponse = {
  ok: true;
  /** By the ref as asked for (`session:claude:<uuid>`, a Scout session id). */
  sources: Record<string, TerminalSource>;
};
