import { describe, expect, test } from "bun:test";
import { plainLine } from "./plain-line.ts";
import { MAC_HOME_ROOT } from "../test-support/path-fixtures.ts";

describe("plain lines", () => {
  test("an absolute path reads as its name", () => {
    expect(plainLine(`Verify the narrow final correction in ${MAC_HOME_ROOT}/workstation-user/dev/openscout/demo-app-session-names`)).toBe("Verify the narrow final correction in demo-app-session-names");
    expect(plainLine("Look at ~/dev/scout/docs/dev-instances.md.")).toBe("Look at dev-instances.md.");
  });

  test("a generic file name reads as its folder", () => {
    expect(plainLine(`Open ${MAC_HOME_ROOT}/a/dev/x/design/studio/home-pov/study.md`)).toBe("Open home-pov");
    expect(plainLine("Edit packages/web/client/screens/home/index.tsx")).toBe("Edit home");
  });

  test("a deep relative path reads as its file, a URL stays", () => {
    expect(plainLine("Fix packages/web/client/screens/home/front-page/BackToYou.tsx")).toBe("Fix BackToYou.tsx");
    expect(plainLine("See https://example.com/docs/a/b/guide.html")).toBe("See https://example.com/docs/a/b/guide.html");
    expect(plainLine("Running list redesign: PR https://github.com/example-org/demo-app/pull/1985 (draft-free)")).toBe("Running list redesign: PR #1985 (draft-free)");
    expect(plainLine("df /System/Volumes/Data shows 1.2 GiB")).toBe("df Data shows 1.2 GiB");
    expect(plainLine("PR #1984: https://github.com/example-org/demo-app/pull/1984 (open)")).toBe("PR #1984 (open)");
    expect(plainLine("Rename shared/api/feed.ts")).toBe("Rename shared/api/feed.ts");
  });

  test("a commit hash goes, with what introduced it", () => {
    expect(plainLine("Review PR #1978 at HEAD 38be0905d9ed58fdd63cf688cc369a62a110 for merge")).toBe("Review PR #1978 for merge");
    expect(plainLine("Final read-only check of app 7053fc9d29842fac7388c0cf3f4c7d0")).toBe("Final read-only check of app");
    expect(plainLine("Next round after #1979 (merged as d7fdcb7e1): take the hard one")).toBe("Next round after #1979: take the hard one");
    expect(plainLine("The operator looked at home-pov (5bcc4c688) and said")).toBe("The operator looked at home-pov and said");
  });

  test("words and numbers that are not hashes stay", () => {
    expect(plainLine("Fix the 1280 layout and the deadbeef words")).toBe("Fix the 1280 layout and the deadbeef words");
    expect(plainLine("Ship PR #1990 to main")).toBe("Ship PR #1990 to main");
    expect(plainLine("Previous task inv-request-5627ab91 (completed)")).toBe("Previous task inv-request-5627ab91 (completed)");
  });
});
