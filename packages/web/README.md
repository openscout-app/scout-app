# Scout Web — local extraction

The real Scout Web client and local server from the private applications repository. Build from the repository root with `bun run build`; launch with `bun run start`. The inspection entry fixes the port and runtime, isolates local state and disables writes. Do not use the upstream managed-server or release workflows here.

See the [root README](../../README.md) for commands and the [extraction report](../../FULL-WEB-SPIKE.md) for the dependency, feature and verification boundaries.
