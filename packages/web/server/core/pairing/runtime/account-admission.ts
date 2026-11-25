// Account admission: a device that reaches this host through the account
// directory waits for the host's owner to allow it.
//
// The pairing code is proof of presence: whoever scans it is standing at the
// host. The account's directory entry is not. It is handed out by the cloud to
// whoever the cloud says is the account, so a pass the cloud alone issues would
// let the cloud admit itself. The account room therefore admits a new device
// only with a tap on the host: the request lands in the same shared store the
// LAN "wants to pair" requests use, so the Scout app's Allow/Deny prompt and the
// local portal's notifications show it without anything new. The full Noise
// key binds the approval row; a short key label only helps the owner recognize
// it. Admission requires winning the shared-store fulfillment, not just reading
// an approval. Decline account requests you do not recognize.

import { localConfigHome } from "@openscout/runtime/local-config";

import {
  createPendingPairRequestStore,
  PairRequestCapacityError,
  pairRequestStatePath,
  type PendingPairRequestStore,
} from "../../../pairing-pair-requests.ts";

export type AccountAdmissionDecision = "admitted" | "denied" | "expired";

/** Asks the host's owner about one device; resolves once they decide, or the device leaves. */
export type AdmitAccountDevice = (publicKeyHex: string, signal: AbortSignal) => Promise<AccountAdmissionDecision>;

/** The route the prompt shows, so the owner can tell this from a tap on the network. */
export const ACCOUNT_ADMISSION_ROUTE = "account";
export const ACCOUNT_ADMISSION_LABEL = "A device through your account";

const POLL_MS = 1_000;
/** Past this the device is turned away; it can ask again. */
const MAX_WAIT_MS = 10 * 60_000;

export interface AccountAdmissionOptions {
  store?: PendingPairRequestStore;
  pollMs?: number;
  maxWaitMs?: number;
  now?: () => number;
}

export function createAccountAdmission(options: AccountAdmissionOptions = {}): AdmitAccountDevice {
  let store = options.store ?? null;
  const pollMs = options.pollMs ?? POLL_MS;
  const maxWaitMs = options.maxWaitMs ?? MAX_WAIT_MS;
  const now = options.now ?? Date.now;

  return async (publicKeyHex, signal) => {
    store ??= createPendingPairRequestStore({ statePath: pairRequestStatePath(localConfigHome()) });
    let token: string;
    try {
      const request = store.create({
        // One prompt per device key: a tab that reloads while waiting asks again
        // under the same row, and a declined key stays declined until it expires.
        // The short fingerprint is display metadata, never row ownership.
        requesterIp: `key ${publicKeyHex.slice(0, 12)}`,
        requesterPublicKey: publicKeyHex,
        requesterLabel: ACCOUNT_ADMISSION_LABEL,
        route: ACCOUNT_ADMISSION_ROUTE,
      });
      if (request.status === "denied") return "denied";
      token = request.token;
    } catch (error) {
      if (error instanceof PairRequestCapacityError) return "denied";
      throw error;
    }

    const deadline = now() + maxWaitMs;
    while (!signal.aborted && now() < deadline) {
      const request = store.get(token);
      if (!request) return "expired";
      if (request.status === "denied") return "denied";
      if (request.status === "approved") {
        // Another poll or denial can win after the approved read.
        return store.fulfill(token, "approved") ? "admitted" : "expired";
      }
      // Still waiting: keep the prompt up while the device is.
      store.touch(token);
      await sleep(pollMs, signal);
    }
    return "expired";
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}
