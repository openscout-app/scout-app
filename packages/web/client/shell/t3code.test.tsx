import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppShell } from "./AppShell.tsx";
import { isShellPath, resolveShellRoute } from "./routes.ts";
import { ScoutApp } from "./ScoutApp.tsx";
import { CONNECTED_TOOLS } from "./surface-catalog.ts";
import { framingVerdict, loopbackOrigin, parseT3CodeStatus, readT3CodeUrl, t3CodeOriginFromEnv, T3CODE_CONNECT_COMMAND } from "./t3code.ts";
import { t3CodeViewState, T3CodeView } from "./T3CodeSurface.tsx";

describe("T3 Code address", () => {
  test("accepts only loopback http origins with an explicit port", () => {
    expect(loopbackOrigin("http://127.0.0.1:3773")).toBe("http://127.0.0.1:3773");
    expect(loopbackOrigin("http://localhost:3773/")).toBe("http://localhost:3773");
    expect(loopbackOrigin("http://[::1]:3773")).toBe("http://[::1]:3773");
    for (const bad of [
      "https://127.0.0.1:3773", "http://127.0.0.1", "http://example.test:3773", "http://10.0.0.2:3773",
      "http://127.0.0.2:3773", "http://user:secret@127.0.0.1:3773", "http://127.0.0.1:3773/?token=secret",
      "http://127.0.0.1:3773/#t", "http://127.0.0.1:3773/app", "ws://127.0.0.1:3773/ws", "file:///etc/hosts", "", 3773, null,
    ]) expect(loopbackOrigin(bad)).toBeNull();
  });

  test("SCOUT_T3CODE_URL wins and an invalid one fails loudly", () => {
    expect(t3CodeOriginFromEnv({ SCOUT_T3CODE_URL: "http://127.0.0.1:4000", OPENSCOUT_T3_CONNECTIONS: '[{"url":"http://127.0.0.1:3773"}]' })).toBe("http://127.0.0.1:4000");
    expect(() => t3CodeOriginFromEnv({ SCOUT_T3CODE_URL: "https://t3.example.test" })).toThrow("loopback");
    expect(t3CodeOriginFromEnv({})).toBeNull();
  });

  test("OPENSCOUT_T3_CONNECTIONS gives only the first loopback origin, never a token or its name", () => {
    const env = {
      T3_ACCESS_TOKEN: "secret-token-value",
      OPENSCOUT_T3_CONNECTIONS: JSON.stringify([
        { id: "remote", url: "wss://t3.example.test/ws", tokenEnv: "REMOTE_T3_TOKEN" },
        { id: "creds", url: "http://user:pw@127.0.0.1:3000", tokenEnv: "T3_ACCESS_TOKEN" },
        { id: "query", url: "http://127.0.0.1:3001?token=secret-token-value", tokenEnv: "T3_ACCESS_TOKEN" },
        { id: "local", url: "ws://127.0.0.1:3773/ws", tokenEnv: "T3_ACCESS_TOKEN" },
        { id: "later", url: "http://127.0.0.1:3774", tokenEnv: "T3_ACCESS_TOKEN" },
      ]),
    };
    const origin = t3CodeOriginFromEnv(env);
    expect(origin).toBe("http://127.0.0.1:3773");
    expect(JSON.stringify(origin)).not.toMatch(/secret|TOKEN|tokenEnv|local/);
    for (const raw of ["not json", '{"url":"http://127.0.0.1:3773"}', "[1, null, {}]"]) expect(t3CodeOriginFromEnv({ OPENSCOUT_T3_CONNECTIONS: raw })).toBeNull();
  });

  test("the meta tag is display-only and loopback-only", () => {
    const doc = (content: string) => ({ querySelector: () => ({ content }) }) as unknown as Document;
    expect(readT3CodeUrl(doc("http://127.0.0.1:3773"))).toBe("http://127.0.0.1:3773");
    expect(readT3CodeUrl(doc("https://example.invalid"))).toBeNull();
    expect(readT3CodeUrl({ querySelector: () => null } as unknown as Document)).toBeNull();
  });
});

describe("framing headers", () => {
  const parent = "http://127.0.0.1:4173";
  const frame = "http://127.0.0.1:3773";
  const verdict = (headers: Record<string, string>) => framingVerdict(new Headers(headers), parent, frame);

  test("no framing headers allows embedding", () => {
    expect(verdict({})).toEqual({ blocked: false });
    expect(verdict({ "content-security-policy": "default-src 'self'" })).toEqual({ blocked: false });
  });

  test("X-Frame-Options DENY and SAMEORIGIN (another port is another origin) block", () => {
    expect(verdict({ "x-frame-options": "DENY" })).toEqual({ blocked: true, by: "x-frame-options" });
    expect(verdict({ "x-frame-options": "sameorigin" })).toEqual({ blocked: true, by: "x-frame-options" });
    expect(framingVerdict(new Headers({ "x-frame-options": "SAMEORIGIN" }), frame, frame)).toEqual({ blocked: false });
  });

  test("frame-ancestors decides when present, and replaces X-Frame-Options", () => {
    expect(verdict({ "content-security-policy": "frame-ancestors 'none'" })).toEqual({ blocked: true, by: "frame-ancestors" });
    expect(verdict({ "content-security-policy": "default-src 'self'; frame-ancestors 'self'" })).toEqual({ blocked: true, by: "frame-ancestors" });
    expect(verdict({ "content-security-policy": "frame-ancestors http://localhost:4173" })).toEqual({ blocked: true, by: "frame-ancestors" });
    expect(verdict({ "content-security-policy": "frame-ancestors https://127.0.0.1:4173" })).toEqual({ blocked: true, by: "frame-ancestors" });
    for (const allowed of ["*", "http:", "http://127.0.0.1:4173", "127.0.0.1:*", "http://127.0.0.1:*", "'self' http://127.0.0.1:4173"]) {
      expect(verdict({ "content-security-policy": `frame-ancestors ${allowed}`, "x-frame-options": "DENY" })).toEqual({ blocked: false });
    }
    // Every enforced policy must allow it.
    expect(verdict({ "content-security-policy": "frame-ancestors *, frame-ancestors 'none'" })).toEqual({ blocked: true, by: "frame-ancestors" });
  });
});

describe("T3 Code surface", () => {
  test("is a connected tool with its own route, outside the five surfaces", () => {
    expect(CONNECTED_TOOLS.map(t => [t.id, t.route, t.project.href, t.project.license])).toEqual([["t3code", "/t3code", "https://github.com/pingdotgg/t3code", "MIT"]]);
    expect(resolveShellRoute(new URL("http://127.0.0.1:4173/t3code"))).toEqual({ mode: "app", tool: "t3code", view: "tool" });
    expect(isShellPath("/t3code")).toBe(true);
    for (const path of ["/embed/t3code", "/t3code/x"]) expect(isShellPath(path)).toBe(false);
  });

  test("sits under the surfaces in a quiet Connected tools group, with no shortcut", () => {
    const html = renderToStaticMarkup(<AppShell mode="app" active="t3code"><p>content</p></AppShell>);
    expect(html).toContain('<p class="app-groupLabel" id="app-tools-caption">Connected tools</p>');
    expect(html).toContain('<a class="app-surface" href="/t3code" data-kind="tool" aria-current="page" title="T3 Code · pingdotgg/t3code · MIT">');
    expect(html).toContain('<span class="app-crumb">T3 Code</span>');
    expect(html.indexOf("Connected tools")).toBeGreaterThan(html.indexOf('href="/control"'));
    expect(html.match(/aria-keyshortcuts=/g)).toHaveLength(5);
    expect(renderToStaticMarkup(<AppShell mode="app" active="feed" tools={[]}><p /></AppShell>)).not.toContain("Connected tools");
  });

  test("the app route opens the T3 Code page; the embed never lists it", () => {
    const html = renderToStaticMarkup(<ScoutApp url={new URL("http://127.0.0.1:4173/t3code")} t3codeUrl="http://127.0.0.1:3773" />);
    expect(html).toContain('class="app-t3" data-state="checking"');
    expect(html).toContain("127.0.0.1:3773");
    expect(renderToStaticMarkup(<ScoutApp url={new URL("http://127.0.0.1:4173/embed/feed")} />)).not.toMatch(/T3 Code|t3code/);
  });

  const strip = (html: string) => {
    expect(html).toContain('<span class="app-t3Name" id="app-t3-name">T3 Code</span>');
    expect(html).toContain('<a class="app-t3Credit" href="https://github.com/pingdotgg/t3code" target="_blank" rel="noopener noreferrer" title="T3 Code source and license">pingdotgg/t3code · MIT</a>');
  };

  test("unconfigured: explains T3 Code, links it, and shows how to connect over loopback", () => {
    const status = parseT3CodeStatus({ configured: false });
    expect(t3CodeViewState(status)).toBe("setup");
    const html = renderToStaticMarkup(<T3CodeView status={status} />);
    strip(html);
    expect(html).toContain('data-state="setup"');
    expect(html).toContain("Connect T3 Code");
    expect(html).toContain(`<code>${T3CODE_CONNECT_COMMAND}</code>`);
    expect(html).toContain('href="https://github.com/pingdotgg/t3code"');
    expect(html).not.toMatch(/<iframe|Open in T3 Code/);
  });

  test("configured, answering and frameable: the operator's own T3 Code fills the sheet", () => {
    const status = parseT3CodeStatus({ configured: true, url: "http://127.0.0.1:3773", reachable: true, frameBlocked: false });
    expect(t3CodeViewState(status)).toBe("frame");
    const html = renderToStaticMarkup(<T3CodeView status={status} />);
    strip(html);
    expect(html).toContain('<a class="app-t3Open" href="http://127.0.0.1:3773" target="_blank" rel="noopener noreferrer">Open in T3 Code ↗</a>');
    expect(html).toMatch(/<iframe class="app-t3Frame" src="http:\/\/127\.0\.0\.1:3773\/" title="T3 Code" sandbox="allow-scripts allow-same-origin[^"]*"/);
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).not.toContain("app-empty");
  });

  test("configured and answering but framing blocked: says so and opens it in the browser", () => {
    const status = parseT3CodeStatus({ configured: true, url: "http://127.0.0.1:3773", reachable: true, frameBlocked: true, blockedBy: "x-frame-options" });
    expect(t3CodeViewState(status)).toBe("blocked");
    const html = renderToStaticMarkup(<T3CodeView status={status} />);
    strip(html);
    expect(html).toContain("does not allow embedding");
    expect(html).toContain("<code>X-Frame-Options</code>");
    expect(html).toContain('<a class="app-button" href="http://127.0.0.1:3773" target="_blank" rel="noopener noreferrer">Open T3 Code in browser ↗</a>');
    expect(html).not.toContain("<iframe");
    const csp = renderToStaticMarkup(<T3CodeView status={{ ...status, blockedBy: "frame-ancestors" } as typeof status} />);
    expect(csp).toContain("<code>frame-ancestors</code>");
  });

  test("configured but not answering: offers to check again, never a frame", () => {
    const html = renderToStaticMarkup(<T3CodeView status={parseT3CodeStatus({ configured: true, url: "http://127.0.0.1:3773", reachable: false })} />);
    expect(html).toContain('data-state="offline"');
    expect(html).toContain("T3 Code is not answering.");
    expect(html).toContain("Check again");
    expect(html).not.toContain("<iframe");
  });

  test("a status with a non-loopback address reads as not configured", () => {
    expect(parseT3CodeStatus({ configured: true, url: "https://t3.example.test", reachable: true, frameBlocked: false })).toEqual({ configured: false });
    expect(parseT3CodeStatus(null)).toEqual({ configured: false });
  });
});
