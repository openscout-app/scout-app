import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { servePreview } from "./preview-host.ts";

const port = Number(process.env.SCOUT_PREVIEW_PORT ?? 4173);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid SCOUT_PREVIEW_PORT");
let temp: string | undefined;
let child: ChildProcess | undefined;
let host: Awaited<ReturnType<typeof servePreview>> | undefined;
let closing = false;
async function stop(code: number) {
  if (closing) return;
  closing = true;
  try {
    await host?.close();
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      const timer = setTimeout(() => child?.kill("SIGKILL"), 5000);
      try { await exited; } finally { clearTimeout(timer); }
    }
    if (temp) await rm(temp, { recursive: true, force: true });
  } finally { process.exit(code); }
}
process.once("SIGINT", () => void stop(0));
process.once("SIGTERM", () => void stop(0));

try {
  let brokerUrl = process.env.SCOUT_PREVIEW_BROKER_URL;
  if (!brokerUrl) {
    // Only start a foreground child in a new temporary home. Never install a
    // service or pass through broker credentials, harness homes or config.
    temp = await mkdtemp(join(tmpdir(), "sp-"));
    const state = join(temp, "i");
    await mkdir(state, { mode: 0o700 });
    // Ask the OS for an unused loopback port. If the child loses the race it
    // fails to bind; never accept another listener in its place.
    let base = 0;
    while (!base) {
      const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
      const candidate = probe.port;
      probe.stop(true);
      // The pinned core derives auxiliary ports up to base + 41 and reserves
      // a block for the installed runtime. Do not select an overlapping block.
      if (candidate <= 65494 && (candidate < 43069 || candidate > 43151)) base = candidate;
    }
    const entry = join(import.meta.dir, "../node_modules/@openscout/scout/bin/openscout-runtime.mjs");
    child = spawn(process.execPath, ["--no-env-file", entry, "broker"], {
      cwd: temp, stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: "/usr/bin:/bin", HOME: temp, TMPDIR: temp,
        OPENSCOUT_INSTANCE: "preview", OPENSCOUT_INSTANCE_ROOT: state,
        OPENSCOUT_INSTANCE_HOST_LABEL: "local", OPENSCOUT_INSTANCE_PORT_BASE: String(base),
        OPENSCOUT_INSTANCE_MESH: "0", OPENSCOUT_ADVERTISE_SCOPE: "local",
        OPENSCOUT_PARENT_PID: String(process.pid), OPENSCOUT_SCOUTBOT_PROCESS: "0",
        OPENSCOUT_JETSTREAM_ENABLED: "0", OPENSCOUT_OTLP_ENABLED: "0",
        OPENSCOUT_HUB_COLLECTOR: "0", OPENSCOUT_HUB_MANAGED_AGENTS: "0",
      },
    });
    const owned = child;
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Local runtime did not start within 45 seconds")), 45000);
      owned.once("error", error => { clearTimeout(timer); reject(error); });
      owned.once("exit", () => { clearTimeout(timer); reject(new Error("Local runtime stopped before it was ready")); });
      createInterface({ input: owned.stdout! }).on("line", line => {
        if (line.includes(`broker listening on 127.0.0.1:${base} (scope: local,`)) { clearTimeout(timer); resolve(); }
      });
      owned.stderr!.on("data", chunk => process.stderr.write(chunk));
    });
    await ready;
    owned.once("exit", () => { if (!closing) { console.error("Preview runtime stopped."); void stop(1); } });
    brokerUrl = `http://127.0.0.1:${base}`;
  }
  host = await servePreview(brokerUrl, port, { runtime: child ? "temporary" : "existing" });
  // Launchers match the "Scout App Preview: …/embed/feed" line exactly. Keep its wording.
  console.log(`Scout App: ${host.url.origin}/\nScout App Preview: ${host.url.origin}/embed/feed\n${child ? "New temporary Scout runtime" : "Reading the selected local Scout runtime"} · Ctrl-C to stop`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  await stop(1);
}
