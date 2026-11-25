import { expect, test } from "bun:test";
import { answerWorldQuestion, cleanMoves } from "./world-ask.ts";
const key = async () => "fixture-key";
const answer = (value: unknown) => new Response(JSON.stringify({ output_text: JSON.stringify(value) }));
test("World answers keep viewing commands and reject agent actions", () => {
  expect(cleanMoves([":goto @1700000000000", "tell delete it", "ask agent do work", "external", "stash add", "cam rm saved", "unknown", ":pause"])).toEqual(["goto @1700000000000", "pause"]);
});
test("World answers require a key and a nonempty answer", async () => {
  await expect(answerWorldQuestion("why", {}, { resolveApiKey: async () => undefined })).rejects.toMatchObject({ status: 503 });
  await expect(answerWorldQuestion("why", {}, { resolveApiKey: key, fetcher: (async () => answer({ say: "", commands: [] })) as typeof fetch })).rejects.toMatchObject({ status: 502 });
});
test("World answer returns validated moves and handles upstream rejection", async () => {
  expect(await answerWorldQuestion("why", {}, { resolveApiKey: key, fetcher: (async () => answer({ say: "One ask failed.", commands: ["pause", "tell execute"] })) as typeof fetch })).toMatchObject({ say: "One ask failed.", commands: ["pause"] });
  await expect(answerWorldQuestion("why", {}, { resolveApiKey: key, fetcher: (async () => new Response('{"error":{"message":"upstream refused"}}', { status: 429 })) as typeof fetch })).rejects.toMatchObject({ status: 502 });
});
test("World timeout remains active while reading a stalled response body", async () => {
  const fetcher = (async (_url: unknown, init: RequestInit) => new Response(new ReadableStream({
    start(controller) { init.signal!.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError"))); },
  }))) as typeof fetch;
  await expect(answerWorldQuestion("why", {}, { resolveApiKey: key, fetcher, timeoutMs: 5 })).rejects.toMatchObject({ status: 504 });
});
