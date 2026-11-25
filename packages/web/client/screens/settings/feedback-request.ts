import { refreshSessionAuth } from "../../lib/api.ts";
import { sameOriginHost } from "../../lib/hosts/host-client.ts";

/** Feedback belongs to this app's serving host. Never forward a raw note to a
 * different mesh host merely because the operator changed the focused host. */
export async function feedbackRequest<T>(step: "preview" | "send", body: unknown): Promise<T> {
  const request = () => sameOriginHost().fetch(`/api/feedback/${step}`, {
    method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  let response = await request();
  if (response.status === 401 && await refreshSessionAuth()) response = await request();
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof value?.error === "string" ? value.error : "Feedback could not be sent. Try again.");
  if (!value) throw new Error("The host did not acknowledge feedback. Try again.");
  return value as T;
}
