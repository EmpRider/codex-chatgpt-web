const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldVerifyMacCodeSignature } = require("../scripts/mac-signing.cjs");

test("macOS PR packaging mirrors electron-builder's signing gate", () => {
  assert.equal(
    shouldVerifyMacCodeSignature({ GITHUB_EVENT_NAME: "pull_request" }),
    false,
    "ordinary pull-request builds are unsigned, so package verification must not require a signature",
  );
  assert.equal(
    shouldVerifyMacCodeSignature({
      GITHUB_EVENT_NAME: "pull_request",
      CSC_FOR_PULL_REQUEST: "true",
    }),
    true,
    "an explicitly signed pull-request build must still verify its signature",
  );
  assert.equal(shouldVerifyMacCodeSignature({ GITHUB_EVENT_NAME: "push" }), true);
  assert.equal(shouldVerifyMacCodeSignature({}), true);
});
