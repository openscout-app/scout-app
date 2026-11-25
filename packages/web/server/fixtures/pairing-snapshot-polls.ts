// HOME must be selected before imports: pairing paths are fixed at module load.
import { expect, setSystemTime } from "bun:test";
import { loadScoutPairingSessionSnapshots } from "../pairing.ts";

let connections = 0;
const server = Bun.serve({
  port: 0,
  fetch(req, server) { return server.upgrade(req) ? undefined : new Response(); },
  websocket: {
    open() { connections++; },
    message(ws, raw) {
      const req = JSON.parse(String(raw));
      ws.send(JSON.stringify({ id: req.id, result: { type: "data", data: { sessions: [] } } }));
    },
  },
});

try {
  await Promise.all(Array.from({ length: 100 }, () => loadScoutPairingSessionSnapshots(server.port!)));
  expect(connections).toBe(1);
  await loadScoutPairingSessionSnapshots(server.port!);
  expect(connections).toBe(1);
  setSystemTime(new Date(Date.now() + 6_000));
  try {
    await loadScoutPairingSessionSnapshots(server.port!);
  } finally {
    setSystemTime();
  }
  expect(connections).toBe(2);
} finally { server.stop(true); setSystemTime(); }

