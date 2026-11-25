import { useMemo, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import type { MessageMarkupBlock } from "../../lib/message-markup.ts";

export const VISUAL_REPLY_LIMIT = 200_000;
export const VISUAL_REPLY_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
export function isVisualReply(block: Extract<MessageMarkupBlock, { type: "code" }>) {
  return block.language?.toLowerCase() === "html" && block.text.length <= VISUAL_REPLY_LIMIT
    && /^\s*(?:<!doctype html[^>]*>\s*)?<html[\s>]/iu.test(block.text) && /<\/html>\s*$/iu.test(block.text);
}

/** A static, opaque-origin document. No runtime bridge, scripts, or network access. */
export function visualReplyDocument(html: string): string {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.querySelectorAll("script,meta,base,link,iframe,frame,frameset,object,embed,form,animate,set,animateMotion,animateTransform").forEach((node) => node.remove());
  // Sandbox blocks top navigation/popups; remove self-navigation as well. Local
  // SVG fragment references still work, and resource loads are governed by CSP.
  parsed.querySelectorAll("*").forEach((node) => {
    for (const attr of [...node.attributes]) {
      if (/^on/iu.test(attr.name) || ["href", "xlink:href", "action", "formaction"].includes(attr.name.toLowerCase()) && !attr.value.startsWith("#")) node.removeAttribute(attr.name);
    }
  });
  const head = `<meta http-equiv="Content-Security-Policy" content="${VISUAL_REPLY_CSP}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{color-scheme:light dark}body{margin:20px;font:14px/1.5 system-ui,sans-serif;color:light-dark(#202124,#e8eaed);background:light-dark(#fff,#17191c)}img,svg{max-width:100%;height:auto}table{border-collapse:collapse}td,th{padding:8px;text-align:left}button,input,select{font:inherit}</style>`;
  return `<!doctype html><html><head>${head}${parsed.head.innerHTML}</head><body>${parsed.body.innerHTML}</body></html>`;
}

export function SessionVisualReply({ block }: { block: Extract<MessageMarkupBlock, { type: "code" }> }) {
  const [preview, setPreview] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const srcDoc = useMemo(() => preview ? visualReplyDocument(block.text) : undefined, [preview, block.text]);
  return <section className={`s-session-visual${expanded ? " is-expanded" : ""}`} aria-label="Visual reply"
    onKeyDown={(event) => { if (event.key === "Escape") { setExpanded(false); event.stopPropagation(); } }}>
    <header><strong>Visual reply</strong><span>Static HTML</span>
      <button type="button" aria-pressed={preview} onClick={() => { setPreview(!preview); setExpanded(false); }}>{preview ? "Source" : "Preview"}</button>
      {preview && <button type="button" aria-label={expanded ? "Shrink visual reply" : "Expand visual reply"} aria-pressed={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? <Minimize2 size={14} aria-hidden /> : <Maximize2 size={14} aria-hidden />}</button>}
    </header>
    {preview ? <iframe title="Visual reply preview" sandbox="" referrerPolicy="no-referrer" srcDoc={srcDoc} />
      : <pre className="s-message-markup-code"><code>{block.text}</code></pre>}
  </section>;
}
