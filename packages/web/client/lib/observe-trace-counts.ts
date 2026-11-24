import { observeToolName } from "./tail-display.ts";

/** A `res:` tail row: the output of a call, written on a line of its own. */
export function observeToolIsResult(tool: string | undefined): boolean {
  return observeToolName(tool) === "res";
}
