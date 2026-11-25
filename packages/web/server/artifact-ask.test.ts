import { describe, expect, test } from "bun:test";
import { answerArtifactAsk, ARTIFACT_ASK_LIMITS, ARTIFACT_ASK_SYSTEM_PROMPT, ArtifactAskInvalid, artifactAskEvidence } from "./artifact-ask.ts";

const request = {
  question: "What changed here, in two sentences?",
  artifact: { what: "changed file", path: "packages/web/client/x.ts", content: "@@ -1 +1 @@\n-old\n+new", contentKind: "diff" },
  agent: { name: "territory-studies", harness: "claude", state: "working", asked: "Build two studies.", said: "Now the shared map.", files: ["a.ts (+4 -0)", 7, "b.ts (+1 -1)"] },
};

describe("artifactAskEvidence", () => {
  test("keeps the question, the artifact and what the agent was asked and said", () => {
    expect(artifactAskEvidence(request)).toEqual({
      question: "What changed here, in two sentences?",
      artifact: { what: "changed file", path: "packages/web/client/x.ts", contentKind: "diff", content: "@@ -1 +1 @@\n-old\n+new", cut: false },
      agent: { name: "territory-studies", harness: "claude", state: "working", asked: "Build two studies.", said: "Now the shared map.", files: ["a.ts (+4 -0)", "b.ts (+1 -1)"] },
    });
  });

  test("a picture has no content, and says so", () => {
    const e = artifactAskEvidence({ question: "Why did it make this?", artifact: { what: "screenshot", path: "~/shots/a.png" } })!;
    expect(e.artifact).toEqual({ what: "screenshot", path: "~/shots/a.png", contentKind: "none", content: "", cut: false });
    expect(e.agent.files).toEqual([]);
  });

  test("long content is cut and marked; a long question is capped", () => {
    const e = artifactAskEvidence({ question: "q".repeat(900), artifact: { path: "a.ts", content: "x".repeat(ARTIFACT_ASK_LIMITS.content + 50) } })!;
    expect(e.question).toHaveLength(ARTIFACT_ASK_LIMITS.question);
    expect(e.artifact.content).toHaveLength(ARTIFACT_ASK_LIMITS.content);
    expect(e.artifact.cut).toBe(true);
    expect(e.artifact.contentKind).toBe("text");
  });

  test("secrets in the content never reach the model", () => {
    const token = `sk-${"a".repeat(48)}`;
    const e = artifactAskEvidence({ question: "What is this?", artifact: { path: ".env", content: `OPENAI_API_KEY=${token}\nAuthorization: Bearer ${token}` } })!;
    expect(JSON.stringify(e)).not.toContain(token);
  });

  test("no question or no path is no request", () => {
    expect(artifactAskEvidence({ question: " ", artifact: { path: "a.ts" } })).toBeNull();
    expect(artifactAskEvidence({ question: "Why?", artifact: {} })).toBeNull();
    expect(artifactAskEvidence(null)).toBeNull();
  });
});

describe("answerArtifactAsk", () => {
  const fail = () => Promise.reject(new Error("no key"));

  test("the quick model answers from the evidence, under the evidence-only prompt", async () => {
    const seen: string[][] = [];
    const out = await answerArtifactAsk({
      request,
      quick: async (prompt, body) => { seen.push([prompt, body]); return { text: " Renamed old to new. ", model: "quick-1" }; },
      fallback: async () => "unused",
    });
    expect(out).toEqual({ answer: "Renamed old to new.", model: "quick-1" });
    expect(seen[0][0]).toBe(ARTIFACT_ASK_SYSTEM_PROMPT);
    expect(JSON.parse(seen[0][1]).artifact.path).toBe("packages/web/client/x.ts");
  });

  test("when the quick model cannot answer, Scoutbot's own model does", async () => {
    expect(await answerArtifactAsk({ request, quick: fail, fallback: async () => "From Scoutbot." })).toEqual({ answer: "From Scoutbot.", model: null });
  });

  test("a final failure or a caller who left does not fall through", async () => {
    let fellBack = false;
    const fallback = async () => { fellBack = true; return "late"; };
    await expect(answerArtifactAsk({ request, quick: fail, fallback, giveUp: () => true })).rejects.toThrow("no key");
    const gone = new AbortController(); gone.abort();
    await expect(answerArtifactAsk({ request, quick: fail, fallback, signal: gone.signal })).rejects.toThrow("no key");
    expect(fellBack).toBe(false);
  });

  test("a request with no question is refused before any model is called", async () => {
    await expect(answerArtifactAsk({ request: { artifact: { path: "a.ts" } }, quick: fail, fallback: fail })).rejects.toBeInstanceOf(ArtifactAskInvalid);
  });
});
