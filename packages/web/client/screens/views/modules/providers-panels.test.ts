import { describe, expect, mock, test } from "bun:test";

import type { Route } from "../../../lib/types.ts";
import type { ServiceGauge } from "../../home/HomeHero.tsx";
import type { BudgetsState } from "../../harnesses/service-budgets-loop.ts";

/*
 * The Providers panels (Subscriptions, Routing, Cloud accounts, Plans &
 * quotas), rendered to markup with the shared Providers loop mocked (the
 * pattern in projects-panels.test.ts).
 */

// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const React = await import("../../../../node_modules/react/index.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxRuntime = await import("../../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxDevRuntime = await import("../../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Bun tests load React DOM's runtime entrypoint directly to avoid local TS path aliases.
const ReactDomServer = await import("../../../../node_modules/react-dom/server.node.js");
const { createElement } = React;
const { renderToStaticMarkup } = ReactDomServer;

mock.module("react", () => React);
mock.module("react/jsx-runtime", () => ReactJsxRuntime);
mock.module("react/jsx-dev-runtime", () => ReactJsxDevRuntime);
mock.module("react-dom", () => ({ createPortal: (children: unknown) => children }));
// The Providers page reads a nav flag. A sibling ~/dev/hudson checkout serves
// hudsonkit's source with its own React, so stub the flag at its default.
const hudsonFlags = await import("hudsonkit/flags");
mock.module("hudsonkit/flags", () => ({ ...hudsonFlags, useOptionalFlag: (_name: string, fallback: unknown) => fallback }));

const NOW = Date.now();

const quota = (id: string, label: string, fill: number): ServiceGauge => ({
  id,
  label,
  kind: "quota",
  fill,
  usedLabel: `${Math.round(fill * 100)}%`,
  capLabel: "100%",
  unitLabel: "%",
  resetAt: NOW + 3_600_000,
  plan: "Max",
});

let budgets: BudgetsState = { gauges: [], cloudAccounts: [], hiddenProviders: [], generatedAt: NOW, loading: true, refreshing: false, error: null };
const freshAsks: boolean[] = [];
mock.module("../../harnesses/use-service-budgets.ts", () => ({
  useServiceBudgets: (options: { fresh?: boolean } = {}) => {
    freshAsks.push(options.fresh === true);
    return { ...budgets, load: async () => undefined };
  },
}));

const { ScoutContext } = await import("../../../scout/Provider.tsx");
const { ModuleHeadSlot } = await import("./ModuleHead.tsx");
const { quotasModule } = await import("./quotas.tsx");
const { subscriptionsModule } = await import("./subscriptions.tsx");
const { cloudAccountsModule } = await import("./cloud-accounts.tsx");
const { providerRoutingModule } = await import("./provider-routing.tsx");

const noop = () => undefined;
const elsewhere: Route = { view: "views", viewId: "machines" };
const providersPage: Route = { view: "harnesses" };

function renderPanel(module: { Component: unknown }, route: Route, config: Record<string, string> = {}): string {
  const scout = { route, navigate: noop, agents: [], agentsLoaded: true };
  const props = { instanceId: "t", route, navigate: noop, config, setConfig: noop };
  const body = createElement(ModuleHeadSlot.Provider, { value: {} as never }, createElement(module.Component as never, props as never));
  return renderToStaticMarkup(createElement(ScoutContext.Provider, { value: scout as never }, body));
}

const read = (patch: Partial<BudgetsState>) => {
  budgets = { gauges: [], cloudAccounts: [], hiddenProviders: [], generatedAt: NOW, loading: false, refreshing: false, error: null, ...patch };
};

describe("Plans & quotas", () => {
  test("reads quietly, says when it failed, and when there is nothing", () => {
    read({ loading: true });
    expect(renderPanel(quotasModule, elsewhere)).toContain("Reading plans");
    read({ error: "offline" });
    expect(renderPanel(quotasModule, elsewhere)).toContain("Couldn&#x27;t read plans.");
    read({});
    expect(renderPanel(quotasModule, elsewhere)).toContain("No plan windows reported.");
  });

  test("a meter per window; a provider scope narrows them; it never forces a refresh", () => {
    freshAsks.length = 0;
    read({ gauges: [quota("claude-max", "Claude 5h", 0.4), quota("codex", "Codex week", 0.9)] });
    const all = renderPanel(quotasModule, elsewhere);
    expect(all).toContain("Claude 5h");
    expect(all).toContain("Codex week");
    expect(all).toContain("90%");
    const scoped = renderPanel(quotasModule, elsewhere, { provider: "claude" });
    expect(scoped).toContain("Claude 5h");
    expect(scoped).not.toContain("Codex week");
    expect(freshAsks.every((fresh) => !fresh)).toBe(true);
  });

  test("Open full only off the Providers page", () => {
    read({ gauges: [quota("codex", "Codex week", 0.2)] });
    expect(renderPanel(quotasModule, elsewhere)).toContain("Open full");
    expect(renderPanel(quotasModule, providersPage)).not.toContain("Open full");
  });
});

describe("Subscriptions", () => {
  test("Kimi's headline pairs weekly usage with its weekly reset and retains 5h details", () => {
    const gauge = quota("kimi", "Kimi", 0.62);
    if (gauge.kind !== "quota") throw new Error("Expected quota");
    gauge.windows = [
      { label: "5h", fill: 0.12, usedLabel: "12%", capLabel: "100%", unitLabel: "quota", resetAt: NOW + 3_600_000, windowMs: 5 * 3_600_000 },
      { label: "7d", fill: 0.62, usedLabel: "62%", capLabel: "100%", unitLabel: "quota", resetAt: NOW + 2 * 86_400_000, windowMs: 7 * 86_400_000 },
    ];
    read({ gauges: [gauge] });
    const html = renderPanel(subscriptionsModule, providersPage, { provider: "kimi" });
    const summary = html.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? "";
    expect(summary).toContain("7d");
    expect(summary).toContain("62%");
    expect(summary).not.toContain("5h");
    expect(summary).not.toContain("12%");
    expect(summary).toMatch(/Next reset: <\/span>\d+d/u);
    expect(html).toContain("5h window");
    expect(html).toContain("12% used");
  });

  test("a row per provider, or the one it is scoped to, with Refresh in the head", () => {
    read({ gauges: [quota("codex", "Codex week", 0.3)] });
    const all = renderPanel(subscriptionsModule, providersPage);
    for (const name of ["Claude", "Codex", "Kimi", "MiniMax", "Cursor"]) expect(all).toContain(name);
    expect(all).toContain("Refresh");
    expect(all).not.toContain("Open full");
    const one = renderPanel(subscriptionsModule, providersPage, { provider: "codex" });
    expect(one).toContain("OpenAI plan windows");
    expect(one).not.toContain("Anthropic plan windows");
  });

  test("detected providers precede undetected ones, alphabetical within each group", () => {
    read({ gauges: [quota("kimi", "Kimi", 0.3), quota("codex", "Codex", 0)] });
    const html = renderPanel(subscriptionsModule, providersPage);
    const names = [...html.matchAll(/<strong>(Codex|Kimi|Claude|Cursor|Grok|MiniMax)<\/strong>/g)].map((match) => match[1]);
    expect(names).toEqual(["Codex", "Kimi", "Claude", "Cursor", "Grok", "MiniMax"]);
    expect(html).toContain("0% used");
  });

  test("a post-reset unknown window is never presented as zero usage or full allowance", () => {
    const gauge = quota("kimi", "Kimi", 0);
    if (gauge.kind !== "quota") throw new Error("Expected quota");
    gauge.windows = [{ label: "7d", fill: 0, usedLabel: "—", capLabel: "100%", unitLabel: "quota", resetAt: NOW + 3_600_000, awaitingReset: true }];
    read({ gauges: [gauge] });
    const html = renderPanel(subscriptionsModule, providersPage, { provider: "kimi" });
    expect(html).toContain("Awaiting reading");
    expect(html).toContain("Awaiting a new reading");
    expect(html).not.toContain("0% used");
    expect(html).not.toContain("100%</strong>");
    expect(html).not.toContain('role="progressbar"');
  });

  test("offers Hide controls with provider-specific accessible names", () => {
    read({});
    const html = renderPanel(subscriptionsModule, providersPage);
    expect(html).toContain('aria-label="Hide MiniMax"');
    expect(html).toContain("You can show it again below.");
    expect(html).not.toContain("Scout stops reading its usage");
  });

  test("hidden host defaults offer Show controls instead of subscription rows", () => {
    read({ hiddenProviders: ["minimax"] });
    const html = renderPanel(subscriptionsModule, providersPage);
    expect(html).toContain('aria-label="Hidden providers"');
    expect(html).toContain("Show MiniMax");
    expect(html).not.toContain('aria-label="Hide MiniMax"');
    expect(html).not.toContain("MiniMax Token Plan");
  });

  test("hiding every provider leaves an explanation and a way to show each one", () => {
    read({ hiddenProviders: ["claude", "codex", "kimi", "grok", "minimax", "cursor"] });
    const html = renderPanel(subscriptionsModule, providersPage);
    expect(html).toContain("All providers are hidden. Show a provider below.");
    expect(html).not.toContain('class="hs-subscription-columns"');
    expect((html.match(/data-provider-show=/g) ?? []).length).toBe(6);
  });

  test("a failed refresh says so, as the page did", () => {
    read({ gauges: [quota("codex", "Codex week", 0.3)], error: "timeout" });
    expect(renderPanel(subscriptionsModule, providersPage)).toContain("refresh: timeout");
  });
});

describe("Cloud accounts", () => {
  test("a quiet line when none are connected; cards when some are", () => {
    read({});
    expect(renderPanel(cloudAccountsModule, providersPage)).toContain("No accounts or integrations found on this host.");
    read({ cloudAccounts: [{ id: "vercel", label: "Vercel", statusLabel: "Connected", detailLabel: "team art" }] });
    const html = renderPanel(cloudAccountsModule, providersPage);
    expect(html).toContain("Vercel");
    expect(html).toContain("team art");
  });
});

describe("Model defaults", () => {
  test("reads catalog defaults and ignores the old routing bias setting", () => {
    read({ gauges: [quota("codex", "Codex week", 0.3)] });
    const html = renderPanel(providerRoutingModule, providersPage, { bias: "quota" });
    expect(html).toContain("Model defaults");
    expect(html).toContain("Included catalog");
    expect(html).toContain("Chosen by harness");
    expect(html).not.toContain('type="range"');
    expect(html).not.toContain("Cascades");
    expect(html).not.toContain("Fit 100");
  });
});


describe("provider discovery entry point", () => {
  test("the full Providers page offers setup and a refresh path even without detected accounts", async () => {
    read({ gauges: [], cloudAccounts: [] });
    const { HarnessesScreen } = await import("../../harnesses/HarnessesScreen.tsx");
    const scout = { route: providersPage, navigate: noop, agents: [], agentsLoaded: true };
    const html = renderToStaticMarkup(createElement(ScoutContext.Provider, { value: scout as never }, createElement(HarnessesScreen, { navigate: noop })));
    expect(html).toContain("Find more providers");
    expect(html).toContain("Copy setup request");
    expect(html).toContain("Refresh providers");
    expect(html.indexOf("Find more providers")).toBeLessThan(html.indexOf('id="hs-subscriptions-title"'));
  });
  test("discovery feedback follows the shared reading error and clears after recovery", async () => {
    const { HarnessesScreen } = await import("../../harnesses/HarnessesScreen.tsx");
    const scout = { route: providersPage, navigate: noop, agents: [], agentsLoaded: true };
    const render = () => renderToStaticMarkup(createElement(ScoutContext.Provider, { value: scout as never }, createElement(HarnessesScreen, { navigate: noop })));
    read({ error: "offline" });
    expect(render()).toContain('aria-live="polite">Couldn’t refresh provider readings. Try Refresh again.');
    read({ error: null });
    expect(render()).not.toContain("Couldn’t refresh provider readings");
  });

});
