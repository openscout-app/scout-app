import { readWorldBrokerSnapshot } from "./db/world.ts";
import { openReadonlyDb } from "./db/internal/db.ts";
import { createInlineWorldWeekService, type WorldWeekOptions } from "./world-week.ts";

declare const self: Worker;
let service: ReturnType<typeof createInlineWorldWeekService>;
self.onmessage = async event => {
  const { options, id, method, value } = event.data;
  if (options) {
    service = createInlineWorldWeekService({ ...options as WorldWeekOptions,
      readBroker: from => readWorldBrokerSnapshot(from, () => openReadonlyDb(0, event.data.dbPath)),
    }); return;
  }
  try {
    let result: unknown;
    switch (method) {
      case "get": result = await service.get(value); break;
      case "json": result = await service.json(value); break;
      case "allowed": result = await service.allowed(); break;
      case "previewable": result = await service.previewable(value); break;
      default: throw new Error("Unknown World worker method");
    }
    self.postMessage({ id, result, stats: service.metrics() });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
