import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("production Stripe acceptance receives the complete runtime contract", async () => {
  const ci = await source(".github/workflows/ci.yml");
  const production = await source(".github/workflows/deploy-production.yml");
  const verifier = await source("scripts/ci/verify-stripe-runtime-catalog.ts");

  assert.match(ci, /STRIPE_WEBHOOK_SECRET:\s*\n\s*required: false/);
  assert.match(
    ci,
    /STRIPE_WEBHOOK_SECRET: \$\{\{ secrets\.STRIPE_WEBHOOK_SECRET \}\}/,
  );
  assert.match(
    production,
    /STRIPE_WEBHOOK_SECRET: \$\{\{ secrets\.STRIPE_WEBHOOK_SECRET \}\}/,
  );
  assert.match(
    verifier,
    /"STRIPE_API_KEY",\s*"STRIPE_WEBHOOK_SECRET",\s*"STRIPE_ATLAS_CATALOG"/,
  );
});
