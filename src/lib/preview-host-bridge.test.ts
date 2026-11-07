import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSafeBridgePath } from "./preview-bridge-path.ts";

describe("isSafeBridgePath", () => {
  it("allows an in-app path, including a query and a hash", () => {
    assert.equal(isSafeBridgePath("/"), true);
    assert.equal(isSafeBridgePath("/settings"), true);
    assert.equal(isSafeBridgePath("/notes?q=a#top"), true);
  });

  it("rejects a path whose history URL would leave the preview origin", () => {
    assert.equal(isSafeBridgePath("//evil.com"), false);
    assert.equal(isSafeBridgePath("/.//evil.com"), false);
    assert.equal(isSafeBridgePath("/foo/..//evil.com"), false);
    assert.equal(isSafeBridgePath("/%2e%2e//evil.com"), false);
    assert.equal(isSafeBridgePath("/\\evil.com"), false);
    assert.equal(isSafeBridgePath("/\t/https://evil.example"), false);
    assert.equal(isSafeBridgePath("/foo\nbar"), false);
    assert.equal(isSafeBridgePath("https://evil.com"), false);
  });
});
