// Set isolation before loading any module that opens a store or snapshots configuration.
import { resolve } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { resolveOpenScoutSupportPaths } from "@openscout/runtime/support-paths";
import { randomBytes } from "node:crypto";

const client = resolve(import.meta.dir, "../dist/client");
if (!existsSync(resolve(client, "index.html"))) throw new Error("Build the full client first: bun run --cwd packages/web build:client");
const readDb = resolve(resolveOpenScoutSupportPaths().controlHome, "control-plane.sqlite");
const state = resolve(import.meta.dir, "../../../.openscout/spike");
mkdirSync(state, { recursive: true, mode: 0o700 });
for (const key of Object.keys(process.env)) if (key.startsWith("OPENSCOUT_") || key.startsWith("SCOUT_")) delete process.env[key];
Object.assign(process.env, {
  OPENSCOUT_WEB_HOST: "127.0.0.1", OPENSCOUT_WEB_PORT: "4177", OPENSCOUT_WEB_STATIC_ROOT: client,
  OPENSCOUT_WEB_PUBLIC_ORIGIN: "http://127.0.0.1:4177", OPENSCOUT_WEB_ADVERTISED_HOST: "127.0.0.1",
  OPENSCOUT_BROKER_HOST: "127.0.0.1", OPENSCOUT_BROKER_PORT: "43110",
  OPENSCOUT_BROKER_URL: "http://127.0.0.1:43110", OPENSCOUT_BROKER_INTERNAL_URL: "http://127.0.0.1:43110",
  OPENSCOUT_CONTROL_HOME: state, OPENSCOUT_SUPPORT_DIRECTORY: state, OPENSCOUT_WEB_AUTH_TOKEN: randomBytes(32).toString("hex"),
  SCOUT_INSPECT_READ_DB: readDb,
});
await import("./index.ts");
