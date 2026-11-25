import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SHIPPED_VIEWS, sideOf } from "../views-model.ts";

/*
 * Holds every module to the contract in README.md. Reads the module files as
 * text: importing them would pull React and hudsonkit into bun test, which this
 * package avoids (see components/HarnessMark.test.tsx).
 */

const dir = import.meta.dir;
// a module file is one that defines a module; helpers beside them (pickers, head slots) are not
const files = readdirSync(dir).filter((f) => f.endsWith(".tsx") && readFileSync(join(dir, f), "utf8").includes("defineModule("));
const registry = readFileSync(join(dir, "registry.ts"), "utf8");

type Parsed = { file: string; type: string; size: { w: number; h: number }; min: { w: number; h: number }; head: string; body: string };

const cell = (src: string, field: string) => {
  const m = src.match(new RegExp(`${field}: \\{ w: (\\d+), h: (\\d+) \\}`));
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
};

// one defineModule({...}) block per module; asks.tsx holds two
const modules: Parsed[] = files.flatMap((file) => {
  const src = readFileSync(join(dir, file), "utf8");
  const head = src.split("*/")[0];
  return src
    .split("defineModule({")
    .slice(1)
    .map((body) => ({
      file,
      type: body.match(/type: "([^"]+)"/)?.[1] ?? "",
      size: cell(body, "size")!,
      min: cell(body, "minSize")!,
      head,
      body,
    }));
});

describe("the module contract", () => {
  test("found the modules", () => {
    expect(modules.length).toBeGreaterThanOrEqual(14);
  });

  test("types are unique", () => {
    const types = modules.map((m) => m.type);
    expect(new Set(types).size).toBe(types.length);
  });

  test("every module file opens with the Shows / Data / Scope / Opens doc block", () => {
    for (const m of modules) for (const label of ["Shows:", "Data:", "Scope:", "Opens:"]) expect(m.head, `${m.file} ${label}`).toContain(label);
  });

  test("every module carries blurb and docs, and its minimum fits inside its default", () => {
    for (const m of modules) {
      expect(m.body, m.type).toMatch(/blurb: "[^"]+"/);
      expect(m.body, m.type).toMatch(/shows: "[^"]+"/);
      expect(m.body, m.type).toMatch(/data: "[^"]+"/);
      expect(m.size, m.type).toBeTruthy();
      expect(m.min, m.type).toBeTruthy();
      expect(m.min.w, m.type).toBeLessThanOrEqual(m.size.w);
      expect(m.min.h, m.type).toBeLessThanOrEqual(m.size.h);
      expect(m.size.w, m.type).toBeLessThanOrEqual(12);
    }
  });

  test("every module file is registered", () => {
    for (const f of files) expect(registry, f).toContain(`./${f}`);
  });

  test("shipped views only use known modules, each at or above its minimum", () => {
    for (const v of SHIPPED_VIEWS) {
      for (const i of v.instances) {
        const m = modules.find((x) => x.type === i.type);
        expect(m, `${v.id}/${i.type}`).toBeDefined();
        // a docked panel is sized in pixels by its side, not in cells
        if (sideOf(v, i.id)) continue;
        const c = v.layout.find((l) => l.id === i.id)!;
        expect(c.w, i.id).toBeGreaterThanOrEqual(m!.min.w);
        expect(c.h, i.id).toBeGreaterThanOrEqual(m!.min.h);
      }
    }
  });
});
