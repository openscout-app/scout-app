import { describe, expect, test } from "bun:test";

import { failedDelivery } from "./request-delivery.ts";

describe("failedDelivery", () => {
  test("a 4xx answer is a refusal with the server's reason", () => {
    const cause = Object.assign(new Error("Permission request version is stale"), { status: 409 });
    expect(failedDelivery("Allow once", cause, "fallback")).toEqual({ state: "refused", label: "Allow once", reason: "Permission request version is stale" });
  });
  test("a 410 means nothing can take the decision any more: ended, with the runtime's reason", () => {
    const cause = Object.assign(new Error("Nothing is waiting on this request any more."), { status: 410 });
    expect(failedDelivery("Allow always", cause, "fallback")).toEqual({ state: "ended", label: "Allow always", reason: "Nothing is waiting on this request any more." });
  });
  test("a 5xx or network failure may have landed, so it is unconfirmed", () => {
    expect(failedDelivery("Allow once", Object.assign(new Error("Bad gateway"), { status: 502 }), "fallback")).toEqual({ state: "unconfirmed", label: "Allow once" });
    expect(failedDelivery("Deny", new TypeError("Failed to fetch"), "fallback")).toEqual({ state: "unconfirmed", label: "Deny" });
  });
});
