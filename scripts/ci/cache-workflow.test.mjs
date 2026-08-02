import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("CI test routing keeps releases complete and ordinary changes surface-specific", async () => {
  const workflow = await source(".github/workflows/ci.yml");
  const testJob = workflow.slice(
    workflow.indexOf("  test:"),
    workflow.indexOf("  acceptance:"),
  );

  assert.match(
    testJob,
    /if \[ "\$RUN_PYTHON_TESTS" = "true" \] && \[ "\$RUN_APP_TESTS" = "true" \]/,
  );
  assert.match(testJob, /pnpm exec turbo run test "\$\{affected_args\[@\]\}"/);
  assert.match(testJob, /@rebuildingamerica\/atlas-api#test/);
  assert.match(
    testJob,
    /pnpm exec turbo run "\$\{python_test_tasks\[@\]\}" "\$\{affected_args\[@\]\}"/,
  );
  assert.match(testJob, /--filter='@rebuildingamerica\/atlas-app\.\.\.'/);
  assert.match(testJob, /--filter='@rebuildingamerica\/entity-widgets-mcp'/);
});

test("each CI job writes a deterministic isolated Turbo cache", async () => {
  const action = await source(".github/actions/setup-toolchain/action.yml");
  const cacheStep = action.slice(action.indexOf("uses: actions/cache@"));

  assert.match(cacheStep, /\$\{\{ github\.job \}\}/);
  assert.match(cacheStep, /\$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(cacheStep, /github\.run_id/);
});

test("CI does not repeatedly authenticate against a broken remote cache", async () => {
  for (const path of [
    ".github/workflows/ci.yml",
    ".github/workflows/deploy-staging.yml",
    ".github/workflows/deploy-production.yml",
  ]) {
    const workflow = await source(path);
    assert.doesNotMatch(workflow, /TURBO_TOKEN/);
    assert.doesNotMatch(workflow, /TURBO_TEAM/);
  }
});
