import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isScriptedCrossSiteRequest } from "./isolation.server.ts";

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe("isScriptedCrossSiteRequest", () => {
  it("allows same-origin, direct loads, and non-browser clients", () => {
    assert.equal(isScriptedCrossSiteRequest(headers({}), "POST"), false);
    assert.equal(
      isScriptedCrossSiteRequest(headers({ "sec-fetch-site": "same-origin" }), "POST"),
      false,
    );
    assert.equal(
      isScriptedCrossSiteRequest(headers({ "sec-fetch-site": "none" }), "GET"),
      false,
    );
  });

  it("allows a cross-site top-level document GET (OAuth callback)", () => {
    assert.equal(
      isScriptedCrossSiteRequest(
        headers({
          "sec-fetch-site": "cross-site",
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document",
        }),
        "GET",
      ),
      false,
    );
  });

  it("blocks a same-site iframe navigation that would still carry the Lax cookie", () => {
    assert.equal(
      isScriptedCrossSiteRequest(
        headers({
          "sec-fetch-site": "same-site",
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "iframe",
        }),
        "GET",
      ),
      true,
    );
  });

  it("blocks scripted cross-site fetches and navigations that omit dest", () => {
    assert.equal(
      isScriptedCrossSiteRequest(
        headers({ "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors" }),
        "POST",
      ),
      true,
    );
    assert.equal(
      isScriptedCrossSiteRequest(
        headers({ "sec-fetch-site": "same-site", "sec-fetch-mode": "navigate" }),
        "GET",
      ),
      true,
    );
  });
});
