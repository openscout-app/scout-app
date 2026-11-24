/** Routes the Feed opens in its containing app. */
export type Route =
  | { view: "feed" }
  | { view: "inbox"; post: string }
  | { view: "sessions"; sessionId: string }
  | { view: "conversation"; conversationId: string; workId?: string }
  | { view: "work"; workId: string };

/** The portions of local read responses the Feed consumes. */
export type ScoutRepoDiffSnapshot = { layers: Array<{ rawPatch?: string | null }> };
export type TailEvent = { sessionId: string };
export type ObserveData = {
  events: ObserveEvent[];
  files: ObserveFile[];
  metadata?: { session?: { externalSessionId?: string } };
};

export type ObserveEventKind =
  | "think"
  | "tool"
  | "ask"
  | "message"
  | "note"
  | "system"
  | "boot";

export interface ObserveEvent {
  id: string;
  t: number;
  at?: number;
  kind: ObserveEventKind;
  text: string;
  tool?: string;
  arg?: string;
  diff?: { add: number; del: number; preview: string };
  result?: Record<string, string | number>;
  stream?: string[];
  live?: boolean;
  to?: string;
  answer?: string;
  answerT?: number;
  detail?: string;
  /** The harness turn this event belongs to, when the transcript records turns. A new
   *  turn starts a new turn in the thread, even when the prompt that opened it is not here. */
  turn?: string;
}

export interface ObserveFile {
  path: string;
  state: "read" | "created" | "modified";
  touches: number;
  lastT: number;
}
