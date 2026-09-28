import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function workflowSource(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("production rollback is a manual, production-scoped workflow that cannot overlap a deploy", async () => {
  const source = await workflowSource(".github/workflows/rollback-production.yml");

  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /release-tag:/);
  assert.match(source, /api-revision:/);
  assert.match(source, /vercel-deployment-url:/);
  assert.match(source, /environment: production/);
  assert.match(source, /group: deploy-production/);
});

test("production rollback moves both services back and reads back what is served", async () => {
  const source = await workflowSource(".github/workflows/rollback-production.yml");

  assert.match(source, /cloud-run-release\.mjs rollback/);
  assert.match(source, /vercel promote "\$VERCEL_DEPLOYMENT_URL"/);
  assert.match(source, /api\/e2e\/hosted\/billing-inventory/);
  assert.match(source, /"\$served" != "\$EXPECTED_SHA"/);
  assert.match(source, /\/health/);
});

test("rollback inputs reach shell steps only through the environment", async () => {
  const source = await workflowSource(".github/workflows/rollback-production.yml");

  const inputUses = source.split("\n").filter((line) => line.includes("${{ inputs."));
  assert.ok(inputUses.length > 0);
  for (const line of inputUses) {
    assert.match(line, /^\s+[A-Z_]+: \$\{\{ inputs\./, line);
  }
});

test("the next API release takes traffic back from a rolled-back revision", async () => {
  const action = await workflowSource(".github/actions/deploy-atlas-api/action.yml");

  assert.match(action, /revision_traffic: LATEST=100/);
});
