const BRIDGE_PATH_CONTROLS = /[\u0000-\u001F\u007F]/;

/**
 * Paths the preview host is allowed to push into the guest history.
 *
 * The origin check alone is not enough: `new URL("/.//evil.com", base)` stays
 * on `base`, but its pathname is `//evil.com`, and `history.pushState` treats
 * a leading double slash as a protocol-relative URL.
 */
export function isSafeBridgePath(path: string): boolean {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
    return false;
  }
  if (path.includes("\\") || BRIDGE_PATH_CONTROLS.test(path)) return false;
  try {
    const resolved = new URL(path, "https://preview.invalid");
    if (resolved.origin !== "https://preview.invalid") return false;
    const next = `${resolved.pathname}${resolved.search}${resolved.hash}`;
    if (!next.startsWith("/") || next.startsWith("//")) return false;
    const again = new URL(next, "https://preview.invalid");
    return again.origin === "https://preview.invalid" && !again.pathname.startsWith("//");
  } catch {
    return false;
  }
}
