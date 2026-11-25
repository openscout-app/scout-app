/** Read public Scout opinions separately from private accounts and inference. */
import { assertValidScoutModelTaste, parseScoutRuntimeCatalog, SCOUT_MODEL_TASTE, SCOUT_RUNTIME_CATALOG } from "@openscout/protocol";
import { SCOUT_MODEL_INVENTORY_URL, type ScoutModelInventory } from "../shared/model-inventory.ts";

const TTL = 10 * 60_000;
const MAX_BYTES = 1_048_576;
function revisionAtLeast(candidate: string, included: string): boolean {
  const [date, sequence] = candidate.split(".");
  const [baseDate, baseSequence] = included.split(".");
  return date! > baseDate! || (date === baseDate && Number(sequence) >= Number(baseSequence));
}
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok || Number(response.headers.get("content-length")) > MAX_BYTES || !response.body) throw new Error("Inventory unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error("Inventory too large");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export function createModelInventoryReader(options: { fetch?: typeof fetch; now?: () => number } = {}) {
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let cached: ScoutModelInventory | null = null;
  let inflight: Promise<ScoutModelInventory> | null = null;
  return async function read(): Promise<ScoutModelInventory> {
    if (cached && now() - cached.checkedAt < TTL) return cached;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const raw = await boundedJson(await request(SCOUT_MODEL_INVENTORY_URL, {
          method: "GET", headers: { Accept: "application/json" }, credentials: "omit", redirect: "error", signal: AbortSignal.timeout(4_000),
        })) as { schema?: unknown; inventory?: { schemaVersion?: unknown; catalog?: unknown; taste?: unknown } };
        if (raw?.schema !== 1 || raw.inventory?.schemaVersion !== "openscout.model-inventory.v1") throw new Error("Inventory missing");
        const catalog = parseScoutRuntimeCatalog(raw.inventory.catalog);
        assertValidScoutModelTaste(raw.inventory.taste);
        if (!catalog.ok || !revisionAtLeast(catalog.catalog.revision, SCOUT_RUNTIME_CATALOG.revision) || !revisionAtLeast(raw.inventory.taste.revision, SCOUT_MODEL_TASTE.revision)) throw new Error("Inventory predates included data");
        cached = { schemaVersion: "openscout.model-inventory.v1", catalog: catalog.catalog, taste: raw.inventory.taste, source: "published", checkedAt: now() };
      } catch {
        // Keep a previously validated publication on transient failure; no downgrade.
        cached = { schemaVersion: "openscout.model-inventory.v1", catalog: cached?.catalog ?? SCOUT_RUNTIME_CATALOG, taste: cached?.taste ?? SCOUT_MODEL_TASTE, source: cached && cached.source !== "included" ? "cached" : "included", checkedAt: now() };
      }
      return cached;
    })().finally(() => { inflight = null; });
    return inflight;
  };
}
export const loadScoutModelInventory = createModelInventoryReader();
