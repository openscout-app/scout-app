import { expect, test } from "bun:test";
import fixture from "../../../shared/test-fixtures/operator-notify-image.json";
import { canonicalImageId } from "../../../shared/canonical-attachments.ts";
import { createNativeAttachmentFetcher, HostedVoiceSource } from "./voice-note-source.ts";

test("#97 image bytes use the existing native attachment bridge and release their blob URL", async () => {
  const id = canonicalImageId(fixture, fixture.attachments[0])!;
  const calls: unknown[] = [];
  const revoked: string[] = [];
  const fetchAttachment = createNativeAttachmentFetcher(async <T>(method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    return { id, data: btoa("image-bytes") } as T;
  });
  const loader = new HostedVoiceSource({ kind: "hosted", id, mediaType: "image/png" }, {
    fetchAttachment,
    createObjectURL(bytes, mediaType) {
      expect(new TextDecoder().decode(bytes)).toBe("image-bytes");
      expect(mediaType).toBe("image/png");
      return "blob:image-fixture";
    },
    revokeObjectURL: url => revoked.push(url),
  });
  expect(await loader.load()).toBe("blob:image-fixture");
  expect(calls).toEqual([{ method: "chat.attachment.fetch", params: { id } }]);
  loader.dispose(); loader.dispose();
  expect(revoked).toEqual(["blob:image-fixture"]);
});

test("a mismatched image response cannot create a preview URL", async () => {
  const loader = new HostedVoiceSource({ kind: "hosted", id: "scout-image-v1.fixture", mediaType: "image/png" }, {
    fetchAttachment: async () => ({ id: "wrong", data: btoa("image") }),
    createObjectURL: () => { throw new Error("must not create URL"); }, revokeObjectURL: () => {},
  });
  await expect(loader.load()).rejects.toThrow("wrong");
  expect(loader.objectURL).toBeNull();
  loader.dispose();
});
