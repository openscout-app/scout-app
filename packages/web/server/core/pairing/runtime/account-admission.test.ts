import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccountAdmission, ACCOUNT_ADMISSION_LABEL } from "./account-admission.ts";
import { createPendingPairRequestStore, type PendingPairRequestStore } from "../../../pairing-pair-requests.ts";

const cleanup: Array<() => void> = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });
function sharedStores() {
  const home = mkdtempSync(join(tmpdir(), "account-admission-"));
  const previous = process.env.OPENSCOUT_HOME;
  process.env.OPENSCOUT_HOME = home;
  const statePath = join(home, "requests.json");
  const first = createPendingPairRequestStore({statePath});
  const second = createPendingPairRequestStore({statePath});
  cleanup.push(() => {
    first.dispose(); second.dispose(); rmSync(home, {recursive: true, force: true});
    if (previous === undefined) delete process.env.OPENSCOUT_HOME; else process.env.OPENSCOUT_HOME = previous;
  });
  return {first, second};
}

test("ACCOUNT-PREFIX: distinct full keys cannot share an Allow, even with the same 60-hex prefix", async () => {
  const {first, second: owner} = sharedStores();
  // Synthetic full keys test the binding boundary, not generated private keys
  // with a cryptographic collision. Real Noise admission has a separate witness.
  const key = "a".repeat(60) + "0001", otherKey = "a".repeat(60) + "0002";
  const a = new AbortController(), b = new AbortController();
  const firstResult = createAccountAdmission({store: first, pollMs: 100, maxWaitMs: 1000})(key, a.signal);
  const firstToken = owner.list()[0]!.token;
  const secondResult = createAccountAdmission({store: first, pollMs: 1, maxWaitMs: 1000})(otherKey, b.signal);
  try {
    const rows = owner.list();
    // The second device polls first after the owner allows the FIRST device.
    owner.decide(firstToken, "approve");
    await Bun.sleep(25); b.abort();
    const secondDecision = await secondResult, firstDecision = await firstResult;
    console.log("ACCOUNT_OBSERVATION " + JSON.stringify({id: "prefix", rows: rows.length, firstDecision, secondDecision}));
    expect(rows).toHaveLength(2);
    expect(firstDecision).toBe("admitted");
    expect(secondDecision).toBe("expired");
  } finally { a.abort(); b.abort(); await Promise.all([firstResult, secondResult]); }
});

for (const winner of ["denial", "delivery"] as const) test(`ACCOUNT-CLAIM: a ${winner} that wins before fulfill refuses admission`, async () => {
  const {first, second: owner} = sharedStores();
  let claims = 0;
  // Pause at the store's real claim boundary: another instance wins after the
  // admission read saw approved, before this instance attempts fulfillment.
  const racing: PendingPairRequestStore = {...first, fulfill(token, status) {
    claims++;
    if (winner === "denial") owner.decide(token, "deny");
    else owner.fulfill(token, "approved");
    return first.fulfill(token, status);
  }};
  const signal = new AbortController();
  const result = createAccountAdmission({store: racing, pollMs: 1})("b".repeat(64), signal.signal);
  try {
    owner.decide(owner.list()[0]!.token, "approve");
    const decision = await result;
    console.log("ACCOUNT_OBSERVATION " + JSON.stringify({id: "claim", winner, claims, decision}));
    expect(claims).toBe(1);
    expect(decision).toBe("expired");
  } finally { signal.abort(); await result; }
});

test("ACCOUNT-COPY: the request identifies a device, not an assumed browser", () => {
  expect(ACCOUNT_ADMISSION_LABEL).toBe("A device through your account");
});

test("ACCOUNT-KEY-BINDING: full keys round-trip without truncation or rebinding legacy rows", () => {
  const {first, second} = sharedStores();
  const key = "c".repeat(60) + "0001", other = "c".repeat(60) + "0002", display = `key ${key.slice(0, 12)}`;
  const legacy = first.create({requesterIp: display});
  first.decide(legacy.token, "approve");
  const input = {requesterIp: display, requesterPublicKey: key.toUpperCase()};
  const request = first.create(input);
  input.requesterPublicKey = other;
  expect(request.token).not.toBe(legacy.token);
  expect(second.get(request.token)?.requesterPublicKey).toBe(key);
  expect(second.create({requesterIp: display, requesterPublicKey: key}).token).toBe(request.token);
  expect(second.create({requesterIp: display, requesterPublicKey: other}).token).not.toBe(request.token);
  expect(() => first.create({requesterIp: display, requesterPublicKey: key.slice(0, 60)})).toThrow("full Noise public key");
});
