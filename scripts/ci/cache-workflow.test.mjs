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

  assert.match(action, /cache-scope:/);
  assert.match(cacheStep, /inputs\.cache-scope \|\| github\.job/);
  assert.match(cacheStep, /\$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(cacheStep, /github\.run_id/);
  assert.doesNotMatch(cacheStep, /turbo-\$\{\{ runner\.os \}\}-\s*$/m);
});

test("test caches distinguish app, Python, and full release work", async () => {
  const workflow = await source(".github/workflows/ci.yml");
  const testJob = workflow.slice(
    workflow.indexOf("  test:"),
    workflow.indexOf("  acceptance:"),
  );

  assert.match(testJob, /cache-scope:/);
  assert.match(testJob, /'test-full'/);
  assert.match(testJob, /'test-python'/);
  assert.match(testJob, /'test-app'/);
});

test("app-only test runs skip Python and PostgreSQL setup", async () => {
  const workflow = await source(".github/workflows/ci.yml");
  const testJob = workflow.slice(
    workflow.indexOf("  test:"),
    workflow.indexOf("  acceptance:"),
  );

  assert.doesNotMatch(testJob, /^    services:/m);
  assert.match(
    testJob,
    /python: \$\{\{ needs\.changes\.outputs\.python_tests \}\}/,
  );
  assert.match(testJob, /name: Start PostgreSQL for Python tests/);
  assert.match(
    testJob,
    /if: needs\.changes\.outputs\.python_tests == 'true'/,
  );
});

test("Vitest caching ignores Playwright-only inputs and does not archive coverage", async () => {
  const turbo = JSON.parse(await source("app/turbo.json"));
  const unitTestTask = turbo.tasks.test;

  assert.deepEqual(unitTestTask.outputs, []);
  assert.ok(unitTestTask.inputs.includes("$TURBO_DEFAULT$"));
  assert.ok(unitTestTask.inputs.includes("!coverage/**"));
  assert.ok(unitTestTask.inputs.includes("!tests/acceptance/**/*.spec.ts"));
  assert.ok(unitTestTask.inputs.includes("!tests/e2e/**/*.spec.ts"));
  assert.ok(unitTestTask.inputs.includes("!playwright.config.ts"));
  assert.ok(unitTestTask.inputs.includes("!playwright.hosted*.config.ts"));
  assert.ok(unitTestTask.inputs.includes("!scripts/e2e/**"));
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
