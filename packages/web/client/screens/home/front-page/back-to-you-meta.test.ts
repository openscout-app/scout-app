import { describe, expect, test } from "bun:test";
import { decisionBody, genericAgentName, notSentLine, turnName, usualProject } from "./back-to-you-meta.ts";

describe("Back to you metadata", () => {
  test("generic names name nothing: '<project> session', crew codenames, runtime ids", () => {
    for (const name of ["demo-app session", "demo-app-home-pov session", "epicurus-16", "tolstoy-5", "session-mwfnli2f-rclj11", "", null]) {
      expect(genericAgentName(name)).toBe(true);
    }
    expect(genericAgentName("Canvas in the Feed")).toBe(false);
  });

  test("the session's kept name wins, then a real agent name; never a generic one or the title again", () => {
    expect(turnName({ sessionName: "Rename sessions", agentName: "epicurus-16", title: "Sessions: operator can rename" })).toBe("Rename sessions");
    expect(turnName({ sessionName: null, agentName: "demo-app session", title: "Home" })).toBeNull();
    expect(turnName({ sessionName: "Home", agentName: "reviewer", title: "home" })).toBe("reviewer");
  });

  test("the usual project is the one most rows share", () => {
    expect(usualProject(["demo-app", "scout", "demo-app", null])).toBe("demo-app");
    expect(usualProject([])).toBeNull();
  });

  test("a decision goes to the session as its next turn, with what it answers", () => {
    expect(decisionBody("Pick where cards win", "Only decision, push, blocked")).toBe("Pick where cards win: Only decision, push, blocked.");
    expect(decisionBody(null, "Build it")).toBe("Go with Build it.");
  });

  test("a failed send says it was not sent once, then why", () => {
    expect(notSentLine("This host has no record of this session. It may have run on another host, or ended."))
      .toBe("Not sent. This host has no record of this session. It may have run on another host, or ended.");
    expect(notSentLine("Scout couldn't start this session, so nothing was sent.")).toBe("Scout couldn't start this session, so nothing was sent.");
    expect(notSentLine("  ")).toBe("Not sent.");
  });
});
