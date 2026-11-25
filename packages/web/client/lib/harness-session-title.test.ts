import { describe, expect, test } from "bun:test";
import { harnessSessionTitle, isGeneratedSessionName, operatorNamedSession, sessionTitle } from "./harness-session-title.ts";

describe("harness session names", () => {
  test("a launch name is never a title", () => {
    expect(harnessSessionTitle({ title: "session-abc12345-xyz9-relay-agent", customTitle: "session-abc12345-xyz9-relay-agent", aiTitle: "Fix the sidebar" }))
      .toBe("Fix the sidebar");
    expect(harnessSessionTitle({ title: "flat-claude-4fad8bb9-relay-agent" })).toBeNull();
    expect(harnessSessionTitle({ title: "Terminals density", customTitle: null })).toBe("Terminals density");
  });

  test("a placeholder gives way to the next title the harness has", () => {
    expect(harnessSessionTitle({ title: "Pasted content", customTitle: null, aiTitle: "Add a --csv export" })).toBe("Add a --csv export");
    expect(harnessSessionTitle({ title: "[Pasted text #2 +40 lines]", customTitle: null })).toBeNull();
    expect(harnessSessionTitle({ title: "Pasted content notes", customTitle: null })).toBe("Pasted content notes");
  });

  test("tells the runtime's id-made names from chosen ones", () => {
    expect(isGeneratedSessionName("Session Mwfnli2f Rclj11")).toBe(true);
    expect(isGeneratedSessionName("session-mwfnli2f-rclj11")).toBe(true);
    expect(isGeneratedSessionName("session-mwfnli2f-rclj11-relay-agent")).toBe(true);
    expect(isGeneratedSessionName("openscout-seneca-4")).toBe(false);
    expect(isGeneratedSessionName("Session notes")).toBe(false);
    expect(isGeneratedSessionName("Scout")).toBe(false);
    expect(isGeneratedSessionName(null)).toBe(false);
  });

  test("a session's name wins over the harness's titles, which stay as the harness wrote them", () => {
    const renamed = { title: "Session names", customTitle: "kernel-panic-last-boot", sessionName: "Session names", sessionNameSource: "operator" as const };
    expect(sessionTitle(renamed)).toBe("Session names");
    expect(harnessSessionTitle(renamed)).toBe("kernel-panic-last-boot");
    expect(operatorNamedSession(renamed)).toBe(true);
    const working = { title: "Home: Running list", customTitle: "kernel-panic-last-boot", sessionName: "Home: Running list", sessionNameSource: "work" as const };
    expect(sessionTitle(working)).toBe("Home: Running list");
    expect(operatorNamedSession(working)).toBe(false);
    // an older runtime sends no session name
    expect(sessionTitle({ title: "kernel-panic-last-boot", customTitle: "kernel-panic-last-boot" })).toBe("kernel-panic-last-boot");
  });
});
