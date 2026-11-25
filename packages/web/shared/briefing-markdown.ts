/** Canonical brief sections. Line boundaries, including the final section, are explicit. */
export function splitMarkdownSections(markdown: string) {
  const sections: Record<string, string[]> = Object.create(null);
  let title = "";
  let section = "";
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = line.match(/^##[ \t]+(.+?)[ \t]*$/);
    if (heading) { section = heading[1]!.toLowerCase(); sections[section] ??= []; }
    else if (/^#[ \t]+/.test(line)) title = line.replace(/^#[ \t]+/, "").trim();
    else if (section) sections[section]!.push(line);
  }
  const read = (name: string) => sections[name]?.join("\n").trim() ?? "";
  return { title, headline: read("headline"), findings: read("findings"), recommendation: read("recommendation"), actions: read("actions") };
}

export type MarkdownFinding = {
  tone: "attention" | "risk" | "progress" | "context";
  weight: number;
  text: string;
  references: { label: string; href: string }[];
};

export function parseFindings(block: string): MarkdownFinding[] {
  const findings: MarkdownFinding[] = [];
  let current: MarkdownFinding | null = null;
  for (const line of block.split(/\r?\n/)) {
    const heading = line.match(/^###[ \t]+(Attention|Risk|Progress|Context)[ \t]*[·•|]?[ \t]*(\d+)?[ \t]*$/i);
    if (heading) {
      current = { tone: heading[1]!.toLowerCase() as MarkdownFinding["tone"], weight: Math.max(1, Math.min(10, Number(heading[2] ?? 5))), text: "", references: [] };
      findings.push(current);
    } else if (current) {
      const text = line.trim();
      const ref = text.match(/^(?:-[ \t]*(?:\w+:[ \t]*)?)?\[([^\]]+)\]\(([^)]+)\)$/);
      if (ref) current.references.push({ label: ref[1]!.trim(), href: ref[2]!.trim() });
      else if (text) current.text = [current.text, text].filter(Boolean).join(" ");
    }
  }
  return findings.filter((finding) => finding.text).sort((a, b) => b.weight - a.weight);
}

export function routeForHref(href: string): Record<string, unknown> | null {
  const trimmed = href.replace(/^\/+/, "").trim();
  if (!trimmed) return null;
  const [head, ...rest] = trimmed.split("/");
  switch (head) {
    case "agents":
      return rest.length > 0
        ? { view: "agents-v2", agentId: rest.join("/") }
        : { view: "agents-v2" };
    case "conversation":
      return rest.length > 0
        ? { view: "conversation", conversationId: rest.join("/") }
        : { view: "conversation" };
    case "work":
      return rest.length > 0
        ? { view: "work", workId: rest.join("/") }
        : { view: "work" };
    case "session":
    case "sessions":
      return rest.length > 0
        ? { view: "sessions", sessionId: rest.join("/") }
        : { view: "sessions" };
    case "ops":
      return rest.length > 0
        ? { view: "ops", mode: rest[0] }
        : { view: "ops" };
    case "activity":
    case "broker":
    case "mesh":
    case "fleet":
    case "inbox":
      return { view: "inbox" };
    case "settings":
      return { view: head };
    default:
      return null;
  }
}

export function routeKindForHref(href: string): "agent" | "conversation" | "work" | "session" | "activity" | "ops" {
  const head = href.replace(/^\/+/, "").split("/")[0] ?? "";
  switch (head) {
    case "agents": return "agent";
    case "conversation": return "conversation";
    case "work": return "work";
    case "session":
    case "sessions": return "session";
    case "activity": return "activity";
    default: return "ops";
  }
}

