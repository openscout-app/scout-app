export function observeToolName(tool: string | undefined): string {
  return (tool ?? "").trim().toLowerCase();
}

export function observeToolIsRead(tool: string | undefined): boolean {
  const name = observeToolName(tool);
  return name === "read" || name === "read_file";
}

export function observeToolIsEdit(tool: string | undefined): boolean {
  const name = observeToolName(tool);
  return name === "edit"
    || name === "write"
    || name === "patch"
    || name === "apply_patch";
}
