import { expect, test } from "bun:test";
import { fallbackWorldCommand, resolveWorldCommand } from "../../../../server/world-command.ts";

test("Find's registry phrases use the existing voice command path without a new resolver verb", () => {
  for (const [phrase, line] of [["open find", "search"], ["find stuck work", "search is:stuck"], ["find failed work", "search is:failed"], ["find running work", "search is:running"]]) {
    const result = fallbackWorldCommand(phrase!);
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.commands).toEqual([line!]);
  }
});

test("spoken literal search words stay a local Find query, not agent routing", async () => {
  const result = await resolveWorldCommand("search planck", {}, { jev: null });
  expect(result.status).toBe("ok"); expect(result.engine).toBe("literal");
  if (result.status === "ok") expect(result.commands).toEqual(["search planck"]);
});
