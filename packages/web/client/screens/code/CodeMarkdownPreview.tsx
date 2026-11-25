import { useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useScout } from "../../scout/Provider.tsx";
import { useShikiLines } from "./ShikiPane.tsx";
import { fenceExtension, rawFileUrlFor, resolveMarkdownTarget } from "./code-markdown-links.ts";

/**
 * A Markdown file as it reads, for the Code reader: GitHub-flavored (tables,
 * task lists, strikethrough, autolinks), fenced code colored by the reader's
 * own Shiki grammars, relative images read from the file's folder and
 * relative links opened in the reader. Raw HTML in the file is not rendered.
 */
export default function CodeMarkdownPreview({
  source,
  path,
  root,
}: {
  source: string;
  path: string;
  root: string | null;
}) {
  const { navigate } = useScout();

  const components = useMemo<Components>(() => ({
    a({ href, children }) {
      const target = href ? resolveMarkdownTarget(path, href) : null;
      if (target?.kind === "file") {
        return (
          <a
            href={href}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey) return;
              event.preventDefault();
              navigate({ view: "code", ...(root ? { root } : {}), file: target.path });
            }}
          >
            {children}
          </a>
        );
      }
      if (target?.kind === "anchor") return <a href={href}>{children}</a>;
      return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
    },
    img({ src, alt }) {
      const target = typeof src === "string" ? resolveMarkdownTarget(path, src) : null;
      const url = target?.kind === "file" ? rawFileUrlFor(target.path) : typeof src === "string" ? src : undefined;
      return <img src={url} alt={alt ?? ""} loading="lazy" />;
    },
    pre({ children }) {
      return <>{children}</>;
    },
    code({ className, children }) {
      const text = String(children ?? "");
      const language = /language-([\w+-]+)/.exec(className ?? "")?.[1];
      // fenced blocks carry a language or span lines; the rest is inline code
      if (!language && !text.includes("\n")) return <code className="s-code-md-inline">{children}</code>;
      return <FencedCode code={text.replace(/\n$/, "")} language={language ?? "text"} />;
    },
    input({ checked, type }) {
      if (type !== "checkbox") return null;
      return <input type="checkbox" checked={Boolean(checked)} readOnly disabled />;
    },
  }), [navigate, path, root]);

  return (
    <article className="s-code-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </article>
  );
}

function FencedCode({ code, language }: { code: string; language: string }) {
  // the grammar is picked from a file name, so a language reads as an extension
  const lines = useShikiLines(code, `block.${fenceExtension(language)}`);
  let body: ReactNode;
  if (lines) {
    body = lines.map((line, index) => (
      // eslint-disable-next-line react/no-array-index-key -- lines are positional
      <span className="line" key={index}>
        {line.map((token, tokenIndex) => (
          // eslint-disable-next-line react/no-array-index-key -- tokens are positional
          <span key={tokenIndex} style={token.style}>{token.content}</span>
        ))}
        {index < lines.length - 1 ? "\n" : ""}
      </span>
    ));
  } else {
    body = code;
  }
  return (
    <pre className="s-code-md-block shiki" data-language={language}>
      <code>{body}</code>
    </pre>
  );
}
