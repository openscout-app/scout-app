/**
 * A read filter over hosts, kept apart from where any action goes. Ported
 * from the iOS app's `FleetReadScope`
 * (packages/scout-ios-core/Sources/ScoutIOSCore/FleetReadScope.swift):
 * choosing which hosts you read never retargets a send, a start or a reply.
 */
export type HostReadScope = { kind: "all" } | { kind: "hosts"; ids: ReadonlySet<string> };

export const ALL_HOSTS: HostReadScope = { kind: "all" };

function lower(ids: Iterable<string>): Set<string> {
  return new Set([...ids].map((id) => id.toLowerCase()));
}

export function selectedHosts(scope: HostReadScope, available: Iterable<string>): Set<string> {
  const known = lower(available);
  if (scope.kind === "all") return known;
  return new Set([...lower(scope.ids)].filter((id) => known.has(id)));
}

/** Unknown or empty requests keep the previous scope. Selecting every host
    follows All, so hosts paired later join it. */
export function applyHostScope(
  current: HostReadScope,
  requested: HostReadScope,
  available: Iterable<string>,
): HostReadScope {
  if (requested.kind === "all") return ALL_HOSTS;
  const known = lower(available);
  const ids = selectedHosts(requested, known);
  if (ids.size === 0) return current;
  return ids.size === known.size ? ALL_HOSTS : { kind: "hosts", ids };
}

/** A plain toggle over what is visibly selected. From All, a tap deselects
    that host. The last selected host can't be deselected. */
export function toggleHost(current: HostReadScope, id: string, available: Iterable<string>): HostReadScope {
  const known = lower(available);
  const key = id.toLowerCase();
  if (!known.has(key)) return current;
  const ids = selectedHosts(current, known);
  if (ids.has(key)) {
    if (ids.size <= 1) return current;
    ids.delete(key);
  } else {
    ids.add(key);
  }
  return applyHostScope(current, { kind: "hosts", ids }, known);
}
