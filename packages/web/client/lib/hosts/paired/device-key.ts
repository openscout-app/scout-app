/**
 * This browser's static key for pairing, the way a phone has one. The Mac
 * remembers a paired device by this key, so it is kept across reloads. With
 * no storage the key lives for the page only, and the Mac sees a new device
 * each time.
 */
import { generateKeyPair, type KeyPair } from "@openscout/runtime/pairing-security/noise";
import { bytesToHex, hexToBytes } from "./bytes.ts";

const STORAGE_KEY = "openscout.web.device-key.v1";

type KeyStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): KeyStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadOrCreateDeviceKey(storage: KeyStorage | null = defaultStorage()): KeyPair {
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null") as { publicKey?: string; privateKey?: string } | null;
    if (saved && /^[0-9a-f]{64}$/.test(saved.publicKey ?? "") && /^[0-9a-f]{64}$/.test(saved.privateKey ?? "")) {
      return { publicKey: hexToBytes(saved.publicKey!), privateKey: hexToBytes(saved.privateKey!) };
    }
  } catch {
    /* unreadable: make a new one */
  }
  const key = generateKeyPair();
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ publicKey: bytesToHex(key.publicKey), privateKey: bytesToHex(key.privateKey) }));
  } catch {
    /* page-only key */
  }
  return key;
}
