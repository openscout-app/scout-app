import type { SlackConnectionStatus } from "./slack-chat-api.ts";

/** The two Slack connection calls Rooms makes, injectable so tests never touch a real account. */
export interface SlackConnectionTransport {
  status(next: string): Promise<SlackConnectionStatus>;
  disconnect(): Promise<unknown>;
}

export type SlackDisconnectOutcome =
  | { ok: true; status: SlackConnectionStatus }
  | { ok: false; error: string };

function reason(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** A failed status read is a state to show, never a rejection for the caller to forget. */
export async function readSlackConnection(
  transport: SlackConnectionTransport,
  next: string,
): Promise<SlackConnectionStatus> {
  try {
    return await transport.status(next);
  } catch (error) {
    return {
      connected: false,
      source: null,
      oauthConfigured: false,
      scopes: [],
      error: reason(error, "Slack connection status could not be read."),
    };
  }
}

/**
 * Disconnects, then re-reads the status. Never rejects: a failed disconnect
 * leaves the connection as it was and names the failure; a disconnect that
 * succeeded is reported as one even when the follow-up read fails.
 */
export async function disconnectSlackConnection(
  transport: SlackConnectionTransport,
  previous: SlackConnectionStatus,
  next: string,
): Promise<SlackDisconnectOutcome> {
  try {
    await transport.disconnect();
  } catch (error) {
    return { ok: false, error: reason(error, "Slack could not be disconnected.") };
  }
  try {
    return { ok: true, status: await transport.status(next) };
  } catch (error) {
    return {
      ok: true,
      status: {
        connected: false,
        source: null,
        oauthConfigured: previous.oauthConfigured,
        scopes: [],
        error: `Slack was disconnected, but its status could not be read. ${reason(error, "")}`.trim(),
      },
    };
  }
}
