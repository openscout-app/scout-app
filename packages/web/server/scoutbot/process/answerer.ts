import {
  assistantClaimHeaders,
  bindAssistantClaim,
  startAssistantAnswerer,
  type ClaimRequest,
} from "@openscout/pairing/answerer-claim";

import { createScoutbotBrokerLink, type ScoutbotBrokerLink } from "./broker-link.ts";
import { startScoutbotClaimProxy } from "./claim-proxy.ts";
import type { ScoutbotProcess, ScoutbotProcessLog } from "./scoutbot-process.ts";

/** What one claim generation runs: Scoutbot itself, and whatever it opened. */
export type ScoutbotGeneration = {
  scoutbot: Pick<ScoutbotProcess, "bootstrap" | "run">;
  /** Closes what this generation opened (its brain, its MCP child). */
  close: () => Promise<void>;
};

export type ScoutbotAnswerer = {
  readonly holderId: string;
  /** Settles after the first claim attempt, held or not. */
  readonly ready: Promise<void>;
  stop: () => Promise<void>;
};

const defaultLog: ScoutbotProcessLog = {
  info: (message) => console.log(`[scoutbot] ${message}`),
  warn: (message) => console.warn(`[scoutbot] ${message}`),
};

/**
 * Scoutbot answers only while it holds the runtime's answerer claim for the
 * scoutbot identity. The runtime refuses every Scoutbot write without it
 * (`409 assistant_claim_required`), registration included.
 *
 * Each claim is one generation. A generation gets a runtime link and an MCP
 * socket bound to its own claim, and builds a fresh Scoutbot on them: brain,
 * MCP child and event loop. When the claim is lost, the generation stops and
 * closes, and its late writes fail rather than borrow the next claim. Work
 * it left unfinished stays in the runtime inbox for the next generation.
 */
export function startScoutbotAnswerer(input: {
  socketPath: string;
  build: (generation: {
    broker: ScoutbotBrokerLink;
    /** The MCP child's runtime socket; writes through it carry this claim. */
    childSocketPath: string;
  }) => ScoutbotGeneration;
  fetch?: typeof fetch;
  retryMs?: number;
  bootstrapRetryMs?: (attempt: number) => number;
  log?: ScoutbotProcessLog;
}): ScoutbotAnswerer {
  const fetchImpl = input.fetch ?? fetch;
  const log = input.log ?? defaultLog;
  const retryDelay = input.bootstrapRetryMs ?? ((attempt: number) => Math.min(30_000, 1_000 * attempt));
  const request: ClaimRequest = (path, init) =>
    fetchImpl(new URL(path, "http://localhost"), { ...init, unix: input.socketPath } as RequestInit);
  let generations = 0;

  const answerer = startAssistantAnswerer({
    mode: "standalone",
    request,
    retryMs: input.retryMs,
    warn: (message) => log.warn(message),
  }, async (signal) => {
    const generation = ++generations;
    const writeHeaders = bindAssistantClaim(assistantClaimHeaders);
    const broker = createScoutbotBrokerLink({ socketPath: input.socketPath, fetch: fetchImpl, writeHeaders });
    const proxy = startScoutbotClaimProxy({ runtimeSocketPath: input.socketPath, writeHeaders, fetch: fetchImpl });
    let built: ScoutbotGeneration | undefined;
    try {
      built = input.build({ broker, childSocketPath: proxy.socketPath });
      log.info(`answerer claim held (generation ${generation})`);
      for (let attempt = 1; !signal.aborted; attempt += 1) {
        try {
          await built.scoutbot.bootstrap();
          break;
        } catch (error) {
          if (signal.aborted) break;
          const delayMs = retryDelay(attempt);
          log.warn(`bootstrap failed (attempt ${attempt}): ${describe(error)}; retrying in ${delayMs}ms`);
          await sleep(delayMs, signal);
        }
      }
      if (!signal.aborted) await built.scoutbot.run(signal);
    } finally {
      await built?.close().catch((error) => log.warn(`generation ${generation} close failed: ${describe(error)}`));
      await proxy.close().catch((error) => log.warn(`generation ${generation} proxy close failed: ${describe(error)}`));
      log.info(`answerer claim ended (generation ${generation})`);
    }
  });

  return { holderId: answerer.holderId, ready: answerer.ready, stop: () => answerer.stop() };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
