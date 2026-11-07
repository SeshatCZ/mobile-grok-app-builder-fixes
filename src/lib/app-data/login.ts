import type { CallToolResult } from "./types.ts";

const GATE_LOGIN_HOSTS = new Set([
  "gate.grok.me",
  "gate.app-builder-testing.com",
]);

/**
 * The gate's sign-in URL, and nothing else. A tool result's `loginUrl` is
 * whatever the upstream JSON said — `javascript:`, a userinfo trick, or a
 * lookalike host must not reach `location.assign` / `window.open`.
 */
export function isTrustedGateLoginUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const loopback =
    parsed.protocol === "http:" &&
    (bare === "localhost" || bare === "127.0.0.1" || bare === "::1");
  const gate = parsed.protocol === "https:" && GATE_LOGIN_HOSTS.has(bare);
  if (!loopback && !gate) return false;
  return parsed.pathname === "/__gate/signin" || parsed.pathname === "/__gate/signin/";
}

export function isLoginRequired(result: CallToolResult): boolean {
  return result.ok === false && result.loginRequired === true;
}

export function isConnectorPending(result: CallToolResult): boolean {
  return result.ok === false && result.pending === true;
}

export function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function redirectToLoginIfRequired(result: CallToolResult): boolean {
  if (!isLoginRequired(result)) return false;
  const url = result.loginUrl;
  if (!url || !isTrustedGateLoginUrl(url)) return false;
  if (typeof window === "undefined") return false;
  if (isFramed()) {
    const opened = window.open(url, "_blank");
    if (opened) {
      opened.opener = null;
      return true;
    }
  }
  window.location.assign(url);
  return true;
}
