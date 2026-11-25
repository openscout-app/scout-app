# Scout Web extraction spike

This worktree runs the full Scout Web client, not the earlier Feed preview. It is a **local inspection build**, not a release. It uses the installed Scout runtime on `127.0.0.1:43110` and opens its control-plane SQLite database read-only. Do not start or replace either installed service.

**Launch the prebuilt app:**

```sh
bun run start
```

Open [Scout](http://127.0.0.1:4177/) or [the standalone Feed](http://127.0.0.1:4177/embed/feed). Stop the foreground process with Ctrl-C. The server binds to IPv4 loopback only, keeps its own cookie and writes derived state to the ignored `.openscout/spike/` directory.

From a clean copy with Bun 1.4.4 and Node 22:

```sh
bun install --frozen-lockfile --ignore-scripts && bun run build && bun run start
```

Run `bun run check` for the upstream typecheck scope, and `bun run test` for the focused Feed client tests. The build uses three pinned public-core source snapshots in `vendor/` until matching registry releases are available. See [the architecture](ARCHITECTURE.md) for the surface exports and the boundary between the local app and the private platform.

Review distribution rights for the extracted source and assets before publishing.
