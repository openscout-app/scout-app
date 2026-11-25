// GET /api/roster, POST /api/roster/projects/code and POST /api/roster/import.
// The runtime's agent roster (OS-003), passed through from its machine-local
// /v1/roster routes. The web server answers these only to a page on its own
// host, as the runtime does.
export type {
  AgentRosterEntry,
  AgentRosterImportConflict,
  AgentRosterImportConflictReason,
  AgentRosterImportEntry,
  AgentRosterImportResult,
  AgentRosterListResult,
  AgentRosterTag,
  RosterProjectRecord,
} from "@openscout/protocol";

/**
 * A refusal, from the runtime or from the web server. `error` is a sentence
 * to show as it is ("OS is held by project \"openscout\""); `code` is the
 * runtime's token (`project_code_held`, `invalid_project_code`, `local_only`,
 * `runtime_unavailable`); `heldBy` names the project that holds a code.
 */
export type RosterRefusal = {
  error: string;
  code: string;
  heldBy?: string;
};
