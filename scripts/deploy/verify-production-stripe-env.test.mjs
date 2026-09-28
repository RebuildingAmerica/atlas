import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = new URL("./verify-production-stripe-env.mjs", import.meta.url);

function run(envs) {
  return spawnSync(process.execPath, [script.pathname], {
    encoding: "utf8",
    input: JSON.stringify({ envs }),
  });
}

const production = (key) => ({ key, target: ["production"] });
const required = [
  production("STRIPE_API_KEY"),
  production("STRIPE_ATLAS_CATALOG"),
  production("STRIPE_WEBHOOK_SECRET"),
  production("STRIPE_BILLING_PORTAL_CONFIGURATION"),
  production("ATLAS_BILLING_ALLOWED_OFFERS"),
];

test("enabled production billing preflight accepts all hosted setting names", () => {
  const result = run(required);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /production billing settings are present/i);
});

test("enabled production billing preflight rejects an absent offer allowlist", () => {
  const result = run(required.slice(0, -1));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ATLAS_BILLING_ALLOWED_OFFERS/);
  assert.doesNotMatch(result.stderr, /rk_live_|sk_live_|whsec_/);
});

test("enabled production billing preflight requires an Atlas portal", () => {
  const result = run(
    required.filter(
      (item) => item.key !== "STRIPE_BILLING_PORTAL_CONFIGURATION",
    ),
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /STRIPE_BILLING_PORTAL_CONFIGURATION/);
});

test("preview-only settings cannot satisfy production billing preflight", () => {
  const result = run([
    ...required.slice(0, -1),
    { key: "ATLAS_BILLING_ALLOWED_OFFERS", target: ["preview"] },
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ATLAS_BILLING_ALLOWED_OFFERS/);
});

test("malformed provider metadata fails closed", () => {
  const result = spawnSync(process.execPath, [script.pathname], {
    encoding: "utf8",
    input: "{bad json",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid Vercel environment metadata/i);
});

test("unexpected provider metadata shape fails closed", () => {
  const result = spawnSync(process.execPath, [script.pathname], {
    encoding: "utf8",
    input: JSON.stringify({ envs: "not an array" }),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid Vercel environment metadata/i);
  assert.doesNotMatch(result.stderr, /TypeError|\.filter/);
});
