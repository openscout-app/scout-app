import { execSystemFile } from "@openscout/runtime/system-probes";
import { parseGhPullList, type SwarmPullState } from "../routes/swarm-pulls.ts";

/** The shared recent-PR list is bounded and may time out on a large repository.
 * Resolve the actual references in the writer's window, without another list or
 * a shell per turn. An issue of the same number is not a PR. */
export async function readNamedPulls(repo: string, numbers: number[]): Promise<SwarmPullState[]> {
  const [owner, name] = repo.split("/");
  const pulls: SwarmPullState[] = [];
  const fields =
    "number title url state isDraft mergedAt closedAt updatedAt createdAt headRefName baseRefName additions deletions changedFiles body";
  const ids = [...new Set(numbers.filter((n) => Number.isSafeInteger(n) && n > 0))];
  for (let start = 0; start < ids.length; start += 40) {
    const batch = ids.slice(start, start + 40);
    const read = async (numbers: number[]) => {
      const selection = numbers
        .map((n) => `p${n}: issueOrPullRequest(number:${n}) { ... on PullRequest { ${fields} } }`)
        .join("\n");
      const query = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){${selection}}}`;
      const { stdout } = await execSystemFile(
        "gh",
        ["api", "graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`],
        { timeoutMs: 10_000, maxStdoutBytes: 4 * 1024 * 1024, maxStderrBytes: 64 * 1024 },
      );
      const records = Object.values(JSON.parse(stdout).data?.repository ?? {}).filter(Boolean);
      pulls.push(...parseGhPullList(JSON.stringify(records), repo).values());
    };
    try {
      await read(batch);
    } catch (error) {
      // gh exits nonzero for the entire batch when a referenced number doesn't
      // exist. Don't lose the other PRs or retry an unreachable repository.
      const stderr = (error as { stderr?: string }).stderr ?? "";
      const absent = new Set(
        [...stderr.matchAll(/Could not resolve to an issue or pull request with the number of (\d+)/g)].map((m) => Number(m[1])),
      );
      if (!absent.size) break;
      const rest = batch.filter((n) => !absent.has(n));
      if (rest.length) await read(rest).catch(() => {});
    }
  }
  return pulls;
}
