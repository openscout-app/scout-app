import {
  resolveScoutTerminalRelayHealthUrl,
  resolveScoutTerminalRelayUrl,
} from "../../lib/runtime-config.ts";
import { useTerminalRelay } from "hudsonkit/terminal";
import { TypographicTerminalRelay } from "../../screens/terminal/TypographicTerminalRelay.tsx";

export function ScoutTerminal() {
  const relayUrl = resolveScoutTerminalRelayUrl();
  const healthUrl = resolveScoutTerminalRelayHealthUrl();
  const relay = useTerminalRelay({
    url: relayUrl,
    healthUrl,
    autoConnect: true,
    sessionKey: "scout-terminal",
  });

  return (
    <div style={{ height: "100%", background: "#0d0d0d", overflow: "hidden" }}>
      <TypographicTerminalRelay
        relay={relay}
        search={typeof window === "undefined" ? "" : window.location.search}
        configItems={[
          { label: "ws", value: relayUrl },
          { label: "health", value: healthUrl },
        ]}
      />
    </div>
  );
}
