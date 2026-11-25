/** CLI sign-in is distinct from personal-plan billing access. No inference or refresh. */
export async function cursorCliSignedIn(run: () => Promise<string>): Promise<boolean> {
  try { return JSON.parse(await run()).isAuthenticated === true; } catch { return false; }
}
export const CURSOR_BALANCE_UNAVAILABLE = "Balance unavailable";
