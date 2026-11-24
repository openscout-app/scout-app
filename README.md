# Scout App

Scout App is the source-available interface for [Scout core](https://github.com/openscout-app/scout), the local runtime that coordinates agents. It defines the canonical parameterized UI components (starting with Feed and Chat) used by both the full app and thin standalone launchers, with no hosted services required.

## Start the preview

Install [Bun](https://bun.sh) 1.4.4 or later. The preview has been tested on macOS (Apple silicon). From the root of a fresh checkout, run:

```sh
bun run start
```

Open **http://127.0.0.1:4173/embed/feed**. The command installs the locked public dependencies, builds the client, and starts a temporary Scout runtime on loopback. It does not require a Scout account, another checkout, or an installed Scout service. The first install needs internet access.

A new runtime has no work. Its Feed says **Nothing finished yet.** It does not load sample posts. To see your own work, connect an existing runtime as described below. Press **Ctrl-C** to stop the preview and remove the temporary runtime data. The installed dependencies remain in `node_modules/`.

## Read your local work

If you already run Scout with the Feed work API (tested with 0.5.4), specify its loopback HTTP origin instead:

```sh
SCOUT_PREVIEW_BROKER_URL=http://127.0.0.1:43110 bun run start
```

This mode reads the runtime you named. It does not start, restart, or stop it. If the runtime cannot serve the Feed, the page reports a read failure rather than showing an empty Feed. A runtime that requires credentials is not supported. The preview does not forward tokens or expose write endpoints.

- Click an item to open its detail. **Esc** closes it.
- **Open in Chat** follows both the conversation ID and work ID. A newer message in the same chat does not replace the recorded exchange. If the reply is missing, Chat says so.
- A standalone post has no task discussion. If it names an original harness session, the preview offers that session instead.
- The preview reads the last 14 days. It polls for changes. Sending replies, moving work, provider connections, and hosted enrichment are not part of this preview.

Use the printed loopback URL. Do not expose it through a tunnel or reverse proxy: local records may contain private messages or media. To choose another web port, set `SCOUT_PREVIEW_PORT` (use `0` to select a free port).

## Check the checkout

After installing dependencies, run `bun run check` for both TypeScript projects and `bun run test` for the client, API, and host tests. The [local Feed API guide](packages/web/server/feed/README.md) also documents a compatibility check that writes test-owned records into a temporary public-core SQLite database. Neither the tests nor the first run need a copy of anyone's activity.

## Security and contributions

Report suspected vulnerabilities privately to the maintainers. Keep local records, machine names, checkout paths, and credentials out of public issues and test fixtures.

For a code change, run the checks above and include the results and a short description in your pull request.

## License

Scout App is source-available under the [PolyForm Shield License 1.0.0](LICENSE) (you may use, modify, and distribute it for any non-competing purpose while keeping the required notice; competing products and rebranded commercial offerings are not permitted). Harnesses are identified by name or monochrome plate, not by logo.
