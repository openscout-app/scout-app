/**
 * For you's digester as the web server runs it: the models through the
 * operator's coding-agent subscriptions (no API key), the kept digests in
 * web-state.sqlite, and one log line per call with its model and time.
 */
import { completeViaSubscription } from "../../harness-completion.ts";
import { loadServiceBudgets } from "../../service-budgets.ts";
import { harnessForYouModel } from "./model.ts";
import { ForYouDigester } from "./service.ts";
import { sqliteDigestStore } from "./store.ts";

export function createForYouDigester(): ForYouDigester {
  return new ForYouDigester({
    model: harnessForYouModel({
      complete: (input) => completeViaSubscription(input, { loadGauges: async () => (await loadServiceBudgets()).gauges }),
    }),
    store: sqliteDigestStore(),
    onCall: ({ id, step, usage, error }) => {
      if (error) console.warn(`[for-you] ${step} ${id}: ${error}`);
      else if (usage) console.info(`[for-you] ${step} ${id}: ${usage.model} ${usage.ms}ms`);
    },
  });
}
