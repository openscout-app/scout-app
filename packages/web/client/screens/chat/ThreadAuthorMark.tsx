import { HarnessMark, harnessLabel } from "../../components/HarnessMark.tsx";

/**
 * The author mark in a thread row: the harness that wrote the post (codex,
 * claude, …), never an invented face. The operator and authors whose harness
 * is unknown keep an empty slot of the same size, so every name and body in
 * the thread starts at the same x.
 */
export function ThreadAuthorMark({
  harness,
  className,
}: {
  harness: string | null | undefined;
  className?: string;
}) {
  const known = harness?.trim() || null;
  return (
    <span
      className={["s-thread-msg-mark", className].filter(Boolean).join(" ")}
      data-empty={known ? undefined : "true"}
      title={known ? harnessLabel(known) : undefined}
      aria-hidden="true"
    >
      {known ? <HarnessMark harness={known} size={14} title={null} outline={0.3} /> : null}
    </span>
  );
}
