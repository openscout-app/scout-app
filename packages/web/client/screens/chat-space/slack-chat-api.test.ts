import { afterEach, describe, expect, test } from "bun:test";
import { ChatApiError } from "./chat-api.ts";
import { slackChatApi } from "./slack-chat-api.ts";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

describe("Slack chat transport", () => {
  test("carries Slack's retry delay into polling backoff", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, error: "ratelimited" }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "7" },
    })) as unknown as typeof fetch;
    const error = await slackChatApi.feed("C1").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ChatApiError);
    expect(error).toMatchObject({ status: 429, retryAfterSeconds: 7 });
  });

  test("uploads multipart files without claiming a JSON body", async () => {
    let contentType: string | undefined;
    const forms: FormData[] = [];
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      contentType = (init?.headers as Record<string, string>)["content-type"];
      if (init?.body instanceof FormData) forms.push(init.body);
      return new Response(JSON.stringify({ attachments: [{ id: "F1", mediaType: "text/plain", fileName: "note.txt", url: "/file" }] }), {
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const result = await slackChatApi.uploadAttachments("C1", [new File(["hello"], "note.txt", { type: "text/plain" })]);
    expect(result[0]?.id).toBe("F1");
    expect(contentType).toBeUndefined();
    expect(forms[0]?.get("files")).toBeInstanceOf(File);
  });
});
