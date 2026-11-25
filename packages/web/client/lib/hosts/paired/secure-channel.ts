/**
 * The browser's side of the bridge's encrypted channel. Noise IK as the
 * initiator: the Mac's static key is known from the pairing payload, and IK
 * proves the far end holds it during the handshake itself, so a relay in the
 * middle can't stand in for the Mac. Same JSON wire as the bridge's
 * SecureTransport and the iOS app: `{ phase, payload: base64 }`.
 */
import { NoiseHandshake, type KeyPair, type NoiseSession } from "@openscout/runtime/pairing-security/noise";
import { base64ToBytes, bytesToBase64 } from "./bytes.ts";

type Wire = { phase?: unknown; payload?: unknown };

export interface SecureChannelEvents {
  onReady?: () => void;
  onMessage?: (text: string) => void;
  onError?: (error: Error) => void;
}

export class SecureChannel {
  private readonly handshake: NoiseHandshake;
  private session: NoiseSession | null = null;

  constructor(
    private readonly sendFrame: (frame: string) => void,
    staticKey: KeyPair,
    remoteStaticKey: Uint8Array,
    private readonly events: SecureChannelEvents = {},
  ) {
    this.handshake = new NoiseHandshake("IK", "initiator", staticKey, remoteStaticKey);
  }

  get ready(): boolean {
    return this.session !== null;
  }

  /** Send the first handshake message; call once the socket is open. */
  start(): void {
    this.sendHandshake();
  }

  receive(raw: string): void {
    let wire: Wire;
    try {
      wire = JSON.parse(raw) as Wire;
    } catch {
      return;
    }
    if (typeof wire?.payload !== "string") return;
    try {
      if (wire.phase === "handshake") {
        if (this.session) return;
        this.handshake.readMessage(base64ToBytes(wire.payload));
        if (this.handshake.isComplete()) this.complete();
        else if (this.handshake.isMySend()) this.sendHandshake();
      } else if (wire.phase === "transport") {
        if (!this.session) throw new Error("Transport message before the handshake finished");
        this.events.onMessage?.(new TextDecoder().decode(this.session.decrypt(base64ToBytes(wire.payload))));
      }
    } catch (error) {
      this.events.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  send(text: string): void {
    if (!this.session) throw new Error("The encrypted channel isn't ready");
    const payload = bytesToBase64(this.session.encrypt(new TextEncoder().encode(text)));
    this.sendFrame(JSON.stringify({ phase: "transport", payload }));
  }

  private sendHandshake(): void {
    const payload = bytesToBase64(this.handshake.writeMessage());
    this.sendFrame(JSON.stringify({ phase: "handshake", payload }));
    if (this.handshake.isComplete()) this.complete();
  }

  private complete(): void {
    this.session = this.handshake.finalize();
    this.events.onReady?.();
  }
}
