import { expect, test } from "bun:test";
import { bridgeRouter } from "./router.ts";

test("the versioned native-session reply refuses before touching any input adapter", async () => {
  let touched = false;
  const bridge = new Proxy({}, { get: () => { touched = true; throw new Error("adapter must not run"); } });
  const caller = bridgeRouter.createCaller({ bridge: bridge as never, cwd: "/tmp/scout-wire-test" });
  expect(await caller.mobile.askSessionDurable({ sessionId: "native", harness: "claude", body: "hello", clientMessageId: "stable" }))
    .toMatchObject({ ok: false, code: "session_input_receipts_unsupported" });
  expect(touched).toBe(false);
});
