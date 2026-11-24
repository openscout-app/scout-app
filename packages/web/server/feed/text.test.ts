import { expect, test } from "bun:test";
import { postBody } from "./text.ts";

test("a reply that starts with Opened is not an Open heading", () => {
  expect(postBody("Opened the exact discussion.")).toMatchObject({ landed: "Opened the exact discussion.", open: null });
  expect(postBody("Done.\n\n**Open questions:** Which version?").open).toBe("Which version?");
});
