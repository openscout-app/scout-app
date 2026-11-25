import { createHash } from "node:crypto";
import { requestScoutBrokerJson } from "@openscout/runtime/broker-api";
import { resolveBrokerSocketPathForBaseUrl } from "@openscout/runtime/broker-process-manager";
import { decodeImageLocator, MAX_IMAGE_BYTES } from "../../../shared/canonical-attachments.ts";
import type { ScoutBrokerContext } from "./service.ts";

type ImageRead = { blobId: string; messageId: string; mediaType: string; byteSize: number; mode: string; data: string; fileName?: string };
/** Read only through the broker's membership/message-binding checked API. Never read a hash from disk. */
export async function readCanonicalImage(broker: ScoutBrokerContext, actorId: string, id: string) {
  const ref = decodeImageLocator(id);
  if (!ref || ref[0] !== broker.node.id) return null; // Remote operator authority must not be inherited.
  try {
    const result = await requestScoutBrokerJson<ImageRead>(broker.baseUrl, "/v1/attachments/read", {
      method: "POST", socketPath: resolveBrokerSocketPathForBaseUrl(broker.baseUrl),
      signal: AbortSignal.timeout(10_000),
      body: { actorId, conversationId: ref[1], messageId: ref[2], blobId: ref[3], mode: "image" },
    });
    if (result.blobId !== ref[3] || result.messageId !== ref[2] || result.mediaType !== ref[4]
      || result.byteSize !== ref[5] || result.mode !== "image" || typeof result.data !== "string"
      || result.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) return null;
    const bytes = Buffer.from(result.data, "base64");
    if (bytes.length !== ref[5] || bytes.toString("base64") !== result.data
      || createHash("sha256").update(bytes).digest("hex") !== ref[3]) return null;
    return { id, mediaType: ref[4], size: bytes.length, data: result.data,
      ...(typeof result.fileName === "string" ? { fileName: result.fileName } : {}) };
  } catch { return null; } // Old brokers, expired membership, oversized or unavailable images.
}
