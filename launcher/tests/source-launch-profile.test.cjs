const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const test = require("node:test");
const { electronProfileArgs } = require("../scripts/profile-args.cjs");

test("source app launches the normal supervised Responses runtime", () => {
  assert.deepEqual(electronProfileArgs("C:\\source\\launcher", ["--production-profile"]), ["C:\\source\\launcher"]);
  const entry = readFileSync(resolve(__dirname, "../../scripts/start-launcher.ts"), "utf8");
  assert.match(entry, /run\(\["run", "dev", "--production-profile"\], launcher\)/);
});

test("standalone launcher development still uses the isolated DEV profile", () => {
  assert.deepEqual(electronProfileArgs("C:\\source\\launcher"), ["C:\\source\\launcher", "--dev-profile"]);
  assert.deepEqual(electronProfileArgs("C:\\source\\launcher", ["--some-other-flag"]), ["C:\\source\\launcher", "--dev-profile"]);
});
