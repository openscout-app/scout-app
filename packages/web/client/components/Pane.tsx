import type { ReactNode } from "react";
import { SectionRule } from "./SectionRule.tsx";
import "./pane.css";

/**
 * The page scaffold: a Page holds Panes, a Pane has one head and a body, and
 * the body is divided into Sections. Each level has one way to separate it
 * (docs/design/tokens.md, "Separation"): the shell divides panes, a
 * SectionRule divides sections, and items are rows with a --scout-line
 * hairline. The head is the shared pane head: a --scout-pane-band band with
 * one title style, the same as a composed view's panel head (HudGrid).
 */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className ? `scout-page ${className}` : "scout-page"}>{children}</div>;
}

export function Pane({
  title,
  count,
  tools,
  children,
  className,
}: {
  title: ReactNode;
  /** A bare figure read with the title. */
  count?: ReactNode;
  /** Actions at the head's right, on its centre line. */
  tools?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className ? `scout-pane ${className}` : "scout-pane"}>
      <header className="scout-pane-head">
        <h2 className="scout-pane-title">{title}</h2>
        {count != null && count !== false && <span className="scout-pane-count">{count}</span>}
        {tools != null && tools !== false && <div className="scout-pane-tools">{tools}</div>}
      </header>
      <div className="scout-pane-body">{children}</div>
    </section>
  );
}

export function Section({
  label,
  right,
  children,
  className,
}: {
  /** Without a label the section opens with no rule (a pane's first block). */
  label?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className ? `scout-section ${className}` : "scout-section"}>
      {label != null && label !== false && <SectionRule label={label} right={right} />}
      {children}
    </div>
  );
}
