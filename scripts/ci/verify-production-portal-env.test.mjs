import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = new URL("./verify-production-portal-env.mjs", import.meta.url);

function check(metadata) {
  return spawnSync(process.execPath, [script.pathname], {
    encoding: "utf8",
    input: JSON.stringify(metadata),
  });
}

void test("accepts a production portal setting without exposing its value", () => {
  const result = check({
    envs: [
      {
        key: "STRIPE_BILLING_PORTAL_CONFIGURATION",
        target: ["production"],
        value: "must-not-be-printed",
      },
    ],
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /value is not readable/);
  assert.doesNotMatch(result.stdout + result.stderr, /must-not-be-printed/);
});

void test("rejects preview-only and malformed portal metadata", () => {
  const preview = check({
    envs: [{ key: "STRIPE_BILLING_PORTAL_CONFIGURATION", target: ["preview"] }],
  });
  assert.equal(preview.status, 1);
  assert.match(preview.stderr, /does not list/);

  const malformed = check({ envs: null });
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /metadata/);
});
