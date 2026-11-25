import type { CSSProperties } from "react";
import type { ChatContentBlock, ChatContentLink } from "../../../shared/chat-rich-content.ts";
import type { ChatMessage } from "./chat-api.ts";
import { ChatMessageMarkup } from "./chat-message-markup.tsx";
import { ExternalGlyph, TaskStateGlyph } from "./rooms-glyphs.tsx";

function markup(message: ChatMessage, text: string) {
  return <ChatMessageMarkup message={{ ...message, body: text }} />;
}

/**
 * Slack's task states in Scout's words. The glyph is static: this is the card
 * as Slack stored it, not a live Scout record, so nothing animates.
 */
export function taskState(status: string): { key: string; label: string | null } {
  switch (status) {
    case "pending": return { key: "pending", label: "Waiting" };
    case "in_progress": return { key: "in_progress", label: "Working" };
    case "complete": case "completed": case "done": return { key: "complete", label: "Done" };
    case "error": case "failed": return { key: "error", label: "Failed" };
    case "unknown": case "": return { key: "unknown", label: null };
    default: {
      const words = status.replaceAll("_", " ").trim();
      return { key: "unknown", label: words ? words[0]!.toUpperCase() + words.slice(1) : null };
    }
  }
}

const LEGACY_COLORS: Record<string, string> = {
  good: "var(--green)",
  warning: "var(--amber)",
  danger: "var(--red)",
};

/** Slack returns attachment colors without `#`, or as a legacy word. */
export function attachmentColor(color: string | undefined): string | undefined {
  const value = color?.trim();
  if (!value) return undefined;
  if (LEGACY_COLORS[value]) return LEGACY_COLORS[value];
  if (/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value)) return `#${value}`;
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value)) return value;
  return undefined;
}

/**
 * A section field written the Slack way, a bold line then the value
 * (`*State*\nWorking`, projected as `**State**\n…`), splits into a label and a
 * value so it reads like an attachment field. Anything else stays one run.
 */
export function splitFieldLabel(field: string): { label: string; value: string } | null {
  const matched = /^\*\*([^*\n]+)\*\*[ \t]*\n([\s\S]*)$/u.exec(field);
  if (!matched) return null;
  const label = matched[1]!.trim();
  return label ? { label, value: matched[2]!.trim() } : null;
}

function Field({ field, message }: { field: string; message: ChatMessage }) {
  const split = splitFieldLabel(field);
  if (!split) return <div>{markup(message, field)}</div>;
  return (
    <div>
      <strong>{split.label}</strong>
      {split.value ? markup(message, split.value) : null}
    </div>
  );
}

/** A link control from the payload. It opens its URL in a new tab and does nothing else. */
function LinkButton({ link }: { link: ChatContentLink }) {
  return (
    <a className="chat-rich-link-button" href={link.url} target="_blank" rel="noreferrer">
      <span>{link.label}</span>
      <ExternalGlyph size={12} />
    </a>
  );
}

function Block({ block, message }: { block: ChatContentBlock; message: ChatMessage }) {
  switch (block.type) {
    case "header": return <h3 className="chat-rich-header">{block.text}</h3>;
    case "paragraph": return <div className="chat-rich-paragraph">{markup(message, block.text)}</div>;
    case "section": return (
      <section className="chat-rich-section">
        <div className="chat-rich-section-main">
          {block.text ? markup(message, block.text) : null}
          {block.fields?.length ? <div className="chat-rich-fields">{block.fields.map((field, index) => <Field key={index} field={field} message={message} />)}</div> : null}
        </div>
        {block.link ? <LinkButton link={block.link} /> : null}
      </section>
    );
    case "list": return block.ordered
      ? <ol className="chat-rich-list">{block.items.map((item, index) => <li key={index}>{markup(message, item)}</li>)}</ol>
      : <ul className="chat-rich-list">{block.items.map((item, index) => <li key={index}>{markup(message, item)}</li>)}</ul>;
    case "code": return <pre className="chat-md-pre chat-rich-code"><code>{block.text}</code></pre>;
    case "quote": return <blockquote className="chat-md-quote">{markup(message, block.text)}</blockquote>;
    case "divider": return <hr className="chat-rich-divider" />;
    case "context": return <div className="chat-rich-context">{markup(message, block.text)}</div>;
    case "image": return <img className="chat-rich-image" src={block.url} alt={block.alt} loading="lazy" />;
    case "actions": return <div className="chat-rich-actions">{block.links.map((link) => <LinkButton key={link.url} link={link} />)}</div>;
    case "task": {
      const state = taskState(block.status);
      const hasBody = Boolean(block.details?.length || block.output?.length || block.sources?.length);
      return (
        <section className="chat-rich-task" data-state={state.key} aria-label={`Task: ${block.title}${state.label ? `, ${state.label}` : ""}`}>
          <div className="chat-rich-task-head">
            <span className="chat-rich-task-glyph"><TaskStateGlyph state={state.key} /></span>
            <strong className="chat-rich-task-title">{block.title}</strong>
            {state.label ? <span className="chat-rich-task-state">{state.label}</span> : null}
          </div>
          {hasBody ? (
            <div className="chat-rich-task-body">
              {block.details?.length ? <div className="chat-rich-task-section">{block.details.map((child, index) => <Block key={index} block={child} message={message} />)}</div> : null}
              {block.output?.length ? <div className="chat-rich-task-section" data-part="output">{block.output.map((child, index) => <Block key={index} block={child} message={message} />)}</div> : null}
              {block.sources?.length ? (
                <div className="chat-rich-task-sources">
                  {block.sources.map((source) => (
                    <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                      <span>{source.label}</span>
                      <ExternalGlyph size={12} />
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      );
    }
    case "attachment": {
      const color = attachmentColor(block.color);
      return (
        <section className="chat-rich-attachment" data-colored={color ? "true" : undefined} style={color ? { "--attachment-color": color } as CSSProperties : undefined}>
          {block.pretext ? <div className="chat-rich-attachment-pretext">{markup(message, block.pretext)}</div> : null}
          <div className="chat-rich-attachment-body">
            {block.author ? <div className="chat-rich-attachment-author">{block.author}</div> : null}
            {block.title ? block.titleUrl
              ? <a className="chat-rich-attachment-title" href={block.titleUrl} target="_blank" rel="noreferrer">{block.title}</a>
              : <div className="chat-rich-attachment-title">{block.title}</div> : null}
            {block.text ? markup(message, block.text) : null}
            {block.fields?.length ? (
              <div className="chat-rich-fields">
                {block.fields.map((field, index) => (
                  <div key={index} data-short={field.short === false ? "false" : undefined}>
                    <strong>{field.title}</strong>
                    {markup(message, field.value)}
                  </div>
                ))}
              </div>
            ) : null}
            {block.footer ? <div className="chat-rich-context">{block.footer}</div> : null}
          </div>
        </section>
      );
    }
  }
}

export function ChatRichContent({ message }: { message: ChatMessage }) {
  if (!message.content?.length) return null;
  return <div className="chat-rich-content">{message.content.map((block, index) => <Block key={index} block={block} message={message} />)}</div>;
}
