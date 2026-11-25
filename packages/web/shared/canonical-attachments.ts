/** App-only locator. It selects a message-bound image; it grants no read authority. */
export const IMAGE_LOCATOR_PREFIX = "scout-image-v1.";
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export type ImageLocator = [originNodeId: string, conversationId: string, messageId: string, sha256: string, mediaType: string, byteSize: number];
const imageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
function valid(value: unknown): value is ImageLocator {
  return Array.isArray(value) && value.length === 6
    && value.slice(0, 3).every(v => typeof v === "string" && v.length > 0 && v.length <= 256 && !/[\u0000-\u001f]/u.test(v))
    && typeof value[3] === "string" && /^[a-f0-9]{64}$/u.test(value[3])
    && imageTypes.has(value[4]) && Number.isSafeInteger(value[5]) && value[5] > 0 && value[5] <= MAX_IMAGE_BYTES;
}
export function decodeImageLocator(id: string): ImageLocator | null {
  if (!id.startsWith(IMAGE_LOCATOR_PREFIX) || id.length > 4096) return null;
  try {
    const encoded = id.slice(IMAGE_LOCATOR_PREFIX.length);
    if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) return null;
    const binary = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
    const json = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
    const value: unknown = JSON.parse(json);
    return valid(value) && encode(value) === id ? value : null;
  } catch { return null; }
}
function encode(value: ImageLocator): string {
  return IMAGE_LOCATOR_PREFIX + btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
type ImageMessage = { id: string; conversationId?: string; originNodeId?: string };
type ImageAttachment = { id?: string; mediaType: string; blob?: unknown };
/** Undefined means legacy. Invalid canonical refs deliberately never fall back to URLs. */
export function canonicalImageId(message: ImageMessage, attachment: ImageAttachment): string | undefined {
  if (attachment.id?.startsWith(IMAGE_LOCATOR_PREFIX)) {
    const ref = decodeImageLocator(attachment.id);
    return ref && ref[2] === message.id
      && (!message.conversationId || ref[1] === message.conversationId)
      && (!message.originNodeId || ref[0] === message.originNodeId)
      ? attachment.id : IMAGE_LOCATOR_PREFIX + "invalid";
  }
  if (!("blob" in attachment)) return undefined;
  const blob = attachment.blob as Record<string, unknown> | null;
  const value = [message.originNodeId, message.conversationId, message.id, blob?.sha256, blob?.mediaType, blob?.byteSize];
  return valid(value) && attachment.mediaType === value[4] ? encode(value) : IMAGE_LOCATOR_PREFIX + "invalid";
}
export function canonicalImageUrl(message: ImageMessage, attachment: ImageAttachment): string | undefined {
  const id = canonicalImageId(message, attachment);
  return id === undefined ? undefined : `/api/channels/${encodeURIComponent(decodeImageLocator(id)?.[1] ?? message.conversationId ?? "invalid")}/attachments/${id}`;
}
