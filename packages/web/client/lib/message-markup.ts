/**
 * One list item: the text on its marker line and the lines that continue it,
 * then whatever the item holds below that, such as a nested list, a second
 * paragraph or a code block.
 */
export type MessageMarkupListItem = { text: string; children: MessageMarkupBlock[] };

export type MessageMarkupBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; depth: number; text: string }
  | { type: "hr" }
  | { type: "list"; ordered: boolean; start: number; items: MessageMarkupListItem[] }
  | { type: "blockquote"; text: string }
  | { type: "code"; language: string | null; text: string }
  | { type: "table"; headers: string[]; rows: string[][] };

const FENCE_PATTERN = /^```([a-z0-9_-]+)?\s*$/iu;
const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/u;
const HR_PATTERN = /^(?:-{3,}|\*{3,}|_{3,})$/u;
const LIST_MARKER_PATTERN = /^([ \t]*)([-*+]|(\d{1,9})[.)])([ \t]+)(\S.*)$/u;
const TABLE_SEPARATOR_PATTERN = /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/u;

/**
 * Agent/CLI messages occasionally arrive with a second layer of JSON-style
 * escaping, so intended line breaks are stored as the two visible characters
 * `\\n`. In a transcript that turns otherwise structured prose into one large
 * paragraph.
 *
 * Do not decode every `\\n`: it is legitimate content in source snippets,
 * regular expressions, and Windows paths. A blank-line escape or an escaped
 * break immediately before a Markdown-style block is strong evidence that the
 * whole value is an encoded multiline message. Once that signal is present,
 * restore all of its escaped line breaks before parsing the blocks.
 */
function restoreEscapedMessageLineBreaks(value: string): string {
  if (/[\r\n]/u.test(value)) {
    return value;
  }

  const hasEncodedLayout = /(?:(?:\\r)?\\n){2}/u.test(value)
    || /(?:\\r)?\\n(?=\s*(?:#{1,6}\s|[-*+]\s|>\s|\d+[.)]\s|[A-Z][A-Za-z ]{0,40}:))/u.test(value);
  if (!hasEncodedLayout) {
    return value;
  }

  return value.replace(/\\r\\n|\\n|\\r/gu, "\n");
}

export function normalizeMessageMarkupText(value: string): string {
  const normalized = restoreEscapedMessageLineBreaks(value)
    .replace(/\r\n?/gu, "\n")
    .trim();
  if (!normalized) {
    return "";
  }

  return normalized
    .replace(/([^\n])\s+---\s+(?=(?:#{1,6}\s|\*\*|[A-Z0-9]))/gu, "$1\n\n---\n\n")
    .replace(/([^\n])\s+(#{1,6}\s+)/gu, "$1\n\n$2")
    .replace(/\n{3,}/gu, "\n\n");
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

function isHeading(line: string): boolean {
  return HEADING_PATTERN.test(line.trim());
}

function isHr(line: string): boolean {
  return HR_PATTERN.test(line.trim());
}

/** The width of a line's leading whitespace, with tab stops every four columns. */
function indentOf(line: string): number {
  let width = 0;
  for (const char of line) {
    if (char === " ") width += 1;
    else if (char === "\t") width += 4 - (width % 4);
    else break;
  }
  return width;
}

/** Remove up to `columns` columns of leading whitespace. */
function dedent(line: string, columns: number): string {
  let width = 0;
  let index = 0;
  while (index < line.length && width < columns) {
    const char = line[index];
    if (char === " ") width += 1;
    else if (char === "\t") width += 4 - (width % 4);
    else break;
    index += 1;
  }
  return line.slice(index);
}

type ListMarker = {
  indent: number;
  ordered: boolean;
  start: number;
  /** The column where the item's text begins; continuation lines align to it. */
  contentIndent: number;
  text: string;
};

function listMarker(line: string): ListMarker | null {
  const match = line.match(LIST_MARKER_PATTERN);
  if (!match) {
    return null;
  }
  const indent = indentOf(match[1]!);
  const ordered = match[3] !== undefined;
  return {
    indent,
    ordered,
    start: ordered ? Number(match[3]) : 1,
    contentIndent: indent + match[2]!.length + Math.min(4, match[4]!.length),
    text: match[5]!.trimEnd(),
  };
}

function isListItem(line: string): boolean {
  return listMarker(line) !== null;
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableStart(lines: string[], index: number): boolean {
  const header = lines[index]?.trim();
  const separator = lines[index + 1]?.trim();
  return Boolean(
    header
      && separator
      && header.includes("|")
      && TABLE_SEPARATOR_PATTERN.test(separator),
  );
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index] ?? "";
  const trimmed = line.trim();
  return Boolean(
    isBlank(line)
      || FENCE_PATTERN.test(trimmed)
      || isHeading(line)
      || isHr(line)
      || isListItem(line)
      || trimmed.startsWith(">")
      || isTableStart(lines, index),
  );
}

function nextFilledLine(lines: string[], index: number): number {
  let next = index;
  while (next < lines.length && isBlank(lines[next]!)) {
    next += 1;
  }
  return next;
}

function continuesList(marker: ListMarker | null, first: ListMarker): marker is ListMarker {
  return Boolean(marker && marker.indent <= first.indent && marker.ordered === first.ordered);
}

/**
 * Read one list from `index`. A line indented past the list's markers belongs
 * to the current item, so nested lists, continued text and code stay inside
 * it, across blank lines too. Agents indent a nested list by two spaces as
 * often as by the marker's width, so any deeper indent counts. A line at the
 * list's own indent that is not a marker continues the item's text, unless a
 * blank line or another kind of block comes first.
 */
function parseList(
  lines: string[],
  index: number,
  first: ListMarker,
): { block: MessageMarkupBlock; next: number } {
  const items: MessageMarkupListItem[] = [];
  let cursor = index;

  while (cursor < lines.length) {
    const marker = listMarker(lines[cursor]!);
    if (!continuesList(marker, first)) {
      break;
    }

    const body = [marker.text];
    cursor += 1;
    let afterBlank = false;
    while (cursor < lines.length) {
      const line = lines[cursor]!;
      if (isBlank(line)) {
        const next = nextFilledLine(lines, cursor);
        if (next < lines.length && indentOf(lines[next]!) > first.indent) {
          for (; cursor < next; cursor += 1) body.push("");
          afterBlank = true;
          continue;
        }
        break;
      }
      const indent = indentOf(line);
      if (indent > first.indent) {
        body.push(dedent(line, Math.min(indent, marker.contentIndent)));
        afterBlank = false;
        cursor += 1;
        continue;
      }
      if (!afterBlank && !isBlockStart(lines, cursor)) {
        body.push(line.trim());
        cursor += 1;
        continue;
      }
      break;
    }

    const blocks = parseBlocks(body);
    const [lead, ...rest] = blocks;
    items.push(lead?.type === "paragraph"
      ? { text: lead.text, children: rest }
      : { text: "", children: blocks });

    // Blank lines between items keep the list going when the next filled
    // line is another item of this list.
    const next = nextFilledLine(lines, cursor);
    if (next !== cursor && !continuesList(next < lines.length ? listMarker(lines[next]!) : null, first)) {
      break;
    }
    cursor = next;
  }

  return {
    block: { type: "list", ordered: first.ordered, start: first.start, items },
    next: cursor,
  };
}

export function parseMessageMarkup(value: string): MessageMarkupBlock[] {
  const text = normalizeMessageMarkupText(value);
  if (!text) {
    return [];
  }
  return parseBlocks(text.split("\n"));
}

function parseBlocks(lines: string[]): MessageMarkupBlock[] {
  const blocks: MessageMarkupBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    const fence = trimmed.match(FENCE_PATTERN);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE_PATTERN.test(lines[index]!.trim())) {
        codeLines.push(lines[index]!);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({
        type: "code",
        language: fence[1] ?? null,
        text: codeLines.join("\n"),
      });
      continue;
    }

    if (isHr(line)) {
      blocks.push({ type: "hr" });
      index += 1;
      continue;
    }

    const heading = trimmed.match(HEADING_PATTERN);
    if (heading) {
      blocks.push({
        type: "heading",
        depth: heading[1]!.length,
        text: heading[2]!.trim(),
      });
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const headers = splitTableRow(lines[index]!);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index]!.includes("|") && !isBlank(lines[index]!)) {
        rows.push(splitTableRow(lines[index]!));
        index += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    const marker = listMarker(line);
    if (marker) {
      const list = parseList(lines, index, marker);
      blocks.push(list.block);
      index = list.next;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index]!.trim().startsWith(">")) {
        quoteLines.push(lines[index]!.trim().replace(/^>\s?/u, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", text: quoteLines.join("\n").trim() });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && !isBlockStart(lines, index)) {
      paragraphLines.push(lines[index]!.trimEnd());
      index += 1;
    }
    blocks.push({
      type: "paragraph",
      text: paragraphLines.join("\n").trim(),
    });
  }

  return blocks;
}
