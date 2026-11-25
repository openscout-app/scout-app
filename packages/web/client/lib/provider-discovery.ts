/** A user-reviewed handoff. No account data, credentials or machine identifiers enter it. */
export const PROVIDER_INVENTORY_GUIDE_URL = "https://openscout.app/skills/scout-inventory/SKILL.md";

export const PROVIDER_DISCOVERY_REQUEST = `Help me find the coding agents and provider accounts already configured on the host where this request is running and complete their Scout setup.

Use $scout-inventory if available. Otherwise read ${PROVIDER_INVENTORY_GUIDE_URL} and load its linked references for the integrations you find.

Start with read-only inventory. Keep installed, authenticated, account/quota-readable, and Scout-ready findings separate. Complete supported Scout connection setup for the existing agents and accounts I use. Preserve my model choices, existing integrations and credentials. Let me handle interactive sign-in. Do not purchase credits, switch accounts, restart running agents or make inference calls to test access.

Keep credentials and personal account data local. Report what you found, what you changed, what you verified and what remains unknown. I will return to Scout's Providers page and refresh its readings afterward.`;
