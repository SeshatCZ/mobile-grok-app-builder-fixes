import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isGrokEmbedderOrigin } from "./preview-embedder-origin.ts";

describe("isGrokEmbedderOrigin", () => {
  it("accepts grok hosts, a trailing-dot FQDN, and both spellings of IPv6 loopback", () => {
    assert.equal(isGrokEmbedderOrigin("https://grok.com"), true);
    assert.equal(isGrokEmbedderOrigin("https://app.grok.com."), true);
    assert.equal(isGrokEmbedderOrigin("http://localhost."), true);
    assert.equal(isGrokEmbedderOrigin("http://[::1]:8080"), true);
    assert.equal(isGrokEmbedderOrigin("http://127.0.0.1"), true);
  });

  it("rejects a lookalike host and a non-http URL", () => {
    assert.equal(isGrokEmbedderOrigin("https://grok.com.evil.example"), false);
    assert.equal(isGrokEmbedderOrigin("https://notgrok.com"), false);
    assert.equal(isGrokEmbedderOrigin("http://localhost.evil.com"), false);
    assert.equal(isGrokEmbedderOrigin("javascript:alert(1)"), false);
  });
});
