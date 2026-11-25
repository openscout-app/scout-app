/**
 * A v4 UUID that works on every page. `crypto.randomUUID` exists only in a
 * secure context (HTTPS or localhost), so a page served as
 * http://scout.local:43120 has no such function and a bare call throws.
 * `crypto.getRandomValues` works in any context, so it fills the gap.
 */
export function randomUuid(): string {
  const cryptoRef = globalThis.crypto;
  if (typeof cryptoRef?.randomUUID === "function") return cryptoRef.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof cryptoRef?.getRandomValues === "function") cryptoRef.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
