import { getRequest } from "@tanstack/react-start/server";

/**
 * Fetch-Metadata sibling isolation — **server-only** (`.server.ts` suffix).
 *
 * MUST keep the `.server` suffix: this file imports `@tanstack/react-start/server`
 * (`getRequest` → Node `AsyncLocalStorage`). If it is imported from a dual
 * client/server module under a non-`.server` name, Vite ships it to the browser
 * and the app dies with: `AsyncLocalStorage is not a constructor`.
 *
 * Apps deployed on `*.grok.me` are "same-site" to each other but MUTUALLY
 * UNTRUSTED, and a `SameSite=Lax` session cookie IS sent on same-site
 * subrequests — so without this, a malicious sibling could make a SCRIPTED
 * (fetch/XHR/form-POST) request to this app's server functions and ride this
 * app's session cookie.
 *
 * We allow only: same-origin requests (this app's own client), non-browser
 * requests (SSR / server-to-server, which send no `Sec-Fetch-Site`), and
 * top-level GET navigations (how the OAuth callback and normal page loads
 * arrive). Every cross-site / same-site *scripted* request is rejected.
 * Together with `__Host-` cookies and Better Auth's `trustedOrigins`, this
 * closes the sibling-tenant attack surface. Enforced at the `authMiddleware`
 * chokepoint (see `middleware.ts`).
 */
export class CrossSiteRequestError extends Error {
  readonly status = 403;
  constructor() {
    super("Forbidden: cross-site request blocked");
    this.name = "CrossSiteRequestError";
  }
}

/**
 * True when Fetch Metadata says this is a scripted cross-site (or same-site
 * sibling) request rather than a top-level document navigation.
 *
 * The allowlist is a single shape: `Sec-Fetch-Mode: navigate` + GET +
 * `Sec-Fetch-Dest: document`. A denylist (`dest !== object && dest !== embed`)
 * lets an iframe navigation through — and a same-site iframe on `*.grok.me`
 * still carries the Lax session cookie. Missing `Sec-Fetch-Dest` fails closed
 * for the same reason: if the browser bothered to send `Sec-Fetch-Site`, a
 * document navigation would have named its dest.
 */
export function isScriptedCrossSiteRequest(headers: Headers, method: string): boolean {
  const site = headers.get("sec-fetch-site");
  if (!site || site === "same-origin" || site === "none") return false;
  const topLevelDocument =
    headers.get("sec-fetch-mode") === "navigate" &&
    method === "GET" &&
    headers.get("sec-fetch-dest") === "document";
  return !topLevelDocument;
}

/** Throw `CrossSiteRequestError` for a scripted cross-site/sibling request. */
export function assertSameSiteRequest(): void {
  const request = getRequest();
  if (!request) return; // no request context (e.g. build) — nothing to guard
  if (isScriptedCrossSiteRequest(request.headers, request.method)) {
    throw new CrossSiteRequestError();
  }
}
