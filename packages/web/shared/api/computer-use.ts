// An operator-facing projection. Input, screen contents, tool results and artifact paths stay with the producer.
export type ComputerRunSource = "Action" | "Lattices";
export type ComputerRunState = "Active" | "Completed" | "Failed" | "Cancelled" | "Paused" | "Last seen";
export interface ComputerRun {
  id: string;
  source: ComputerRunSource;
  title: string;
  state: ComputerRunState;
  startedAt: number;
  updatedAt: number;
}
export interface ComputerStep { at: number; label: string }
export interface ComputerActivity {
  runs: ComputerRun[];
  steps: ComputerStep[];
  omittedSteps: number;
  issues: string[];
}

export interface ComputerCall {
  at: number;
  harness: "Codex" | "Claude Code";
  provider: "Computer use" | "Claude in Chrome" | "Action" | "Lattices";
  operation: string;
  returnedAt?: number;
  failed?: boolean;
  /** A live adapter can report the result without recording when it arrived. */
  snapshotResult?: "returned" | "error";
  nativeRun?: string;
}

export interface SessionComputerUse {
  calls: ComputerCall[];
  /** Only the web process that read the local transcript can resolve its native receipts. */
  nativeOrigin?: string;
}

export function safeComputerId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(value);
}
