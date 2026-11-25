import type { ScoutModelTaste, ScoutOwnedRuntimeCatalog } from "@openscout/protocol";

/** Public editorial data only. Personal usage and credentials never enter this feed. */
export type ScoutModelInventory = {
  schemaVersion: "openscout.model-inventory.v1";
  catalog: ScoutOwnedRuntimeCatalog;
  taste: ScoutModelTaste;
  source: "included" | "published" | "cached";
  checkedAt: number;
};
export const SCOUT_MODEL_INVENTORY_URL = "https://openscout.app/.well-known/model-worldview.json";
