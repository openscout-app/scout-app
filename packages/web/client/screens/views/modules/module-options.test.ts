import { describe, expect, test } from "bun:test";

import { configureModule } from "../views-model.ts";
import { moduleOptionOn, moduleOptionPatch, type ModuleOption } from "./contract.ts";
import { homeCockpitModule } from "./home-cockpit.tsx";

const onByDefault: ModuleOption = { key: "gauges", label: "Subscription gauges", default: true };
const offByDefault: ModuleOption = { key: "trace", label: "Load trace", default: false };

describe("module options", () => {
  test("an option is its default until the operator picks", () => {
    expect(moduleOptionOn(onByDefault, {})).toBe(true);
    expect(moduleOptionOn(offByDefault, {})).toBe(false);
    expect(moduleOptionOn(onByDefault, { gauges: "off" })).toBe(false);
    expect(moduleOptionOn(offByDefault, { trace: "on" })).toBe(true);
    expect(moduleOptionOn(onByDefault, { gauges: "garbled" })).toBe(true);
  });

  test("turning an option back to its default clears it, so the view counts no change", () => {
    const instances = [{ id: "home-cockpit", type: "home-cockpit" }];
    const off = configureModule(instances, "home-cockpit", moduleOptionPatch(onByDefault, false));
    expect(off[0]?.config).toEqual({ gauges: "off" });
    expect(moduleOptionOn(onByDefault, off[0]?.config ?? {})).toBe(false);
    const back = configureModule(off, "home-cockpit", moduleOptionPatch(onByDefault, true));
    expect(back[0]).toEqual({ id: "home-cockpit", type: "home-cockpit" });
  });

  test("the Fleet cockpit offers its subscription gauges, on by default", () => {
    expect(homeCockpitModule.options?.map((o) => [o.key, o.label, o.default])).toEqual([["gauges", "Subscription gauges", true]]);
  });
});
