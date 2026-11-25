/** Non-secret, authority-resolved view of one hosted space. */
export type SpaceAccessRole = "owner" | "admin" | "member";
export type SpaceAccessMember = {
  accountId: string;
  displayName: string;
  role: SpaceAccessRole;
  channels: { id: string; title: string }[];
  scope: "space" | "joined";
  activeAgentGrants: number;
  canChangeRole: boolean;
  canRemove: boolean;
};
export type SpaceAccessView = {
  space: { id: string; title: string };
  viewer: { accountId: string; role: "owner" | "admin" };
  members: SpaceAccessMember[];
  rolePermissions: Record<SpaceAccessRole, string[]>;
};

export type SpaceAccessApi = {
  spaceAccess(slug: string): Promise<SpaceAccessView>;
  changeSpaceRole(spaceId: string, accountId: string, role: "admin" | "member"): Promise<unknown>;
  removeSpaceMember(spaceId: string, accountId: string): Promise<unknown>;
};
