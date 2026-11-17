import { headers } from "next/headers";

/**
 * Marker the iOS app appends to its user agent (appendUserAgent in
 * capacitor.config.json). Lets server-rendered pages leave out things a store
 * build must not show, such as a link to an outside checkout.
 */
export const NATIVE_UA_MARKER = "NeuronApp";

export function isNativeAppRequest(): boolean {
  try {
    return (headers().get("user-agent") ?? "").includes(NATIVE_UA_MARKER);
  } catch {
    return false;
  }
}
