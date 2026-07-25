import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

function dryRun(task) {
  const stdout = execFileSync(
    "pnpm",
    ["exec", "turbo", "run", task, "--dry-run=json"],
    { encoding: "utf8" },
  );
  const jsonStart = stdout.indexOf("{");
  assert.notEqual(jsonStart, -1, "Turbo did not emit a JSON dry-run payload.");
  return JSON.parse(stdout.slice(jsonStart));
}

test("test graph contains only runnable package tasks", () => {
  const graph = dryRun("test");
  const missing = graph.tasks
    .filter((task) => task.command === "<NONEXISTENT>")
    .map((task) => task.taskId);

  assert.deepEqual(missing, []);
});

test("app remains in the standard test graph", () => {
  const graph = dryRun("test");

  assert.equal(
    graph.tasks.some(
      (task) => task.taskId === "@rebuildingamerica/atlas-app#test",
    ),
    true,
  );
});

test("behavior packages participate in the native test graph", () => {
  const graph = dryRun("test");
  const taskIds = new Set(graph.tasks.map((task) => task.taskId));

  for (const taskId of [
    "@rebuildingamerica/atlas-ui#test",
    "@rebuildingamerica/atlas-catalog#test",
    "@rebuildingamerica/atlas-access#test",
  ]) {
    assert.equal(taskIds.has(taskId), true, `${taskId} must be runnable through turbo run test`);
  }
});

test("app test has no artificial dependency build chain", () => {
  const graph = dryRun("@rebuildingamerica/atlas-app#test");
  const appTest = graph.tasks.find(
    (task) => task.taskId === "@rebuildingamerica/atlas-app#test",
  );

  assert.ok(appTest);
  assert.deepEqual(appTest.dependencies.filter((taskId) => taskId.endsWith("#build")), []);
});

test("behavior stays colocated instead of accumulating in a shared types bucket", () => {
  assert.equal(existsSync("app/src/types"), false);
  assert.equal(
    readdirSync("packages", { withFileTypes: true }).some(
      (entry) => entry.isDirectory() && entry.name.includes("types"),
    ),
    false,
  );
});

test("API checks share one environment preparation task", () => {
  const graph = dryRun("typecheck");
  const apiTypecheck = graph.tasks.find(
    (task) => task.taskId === "@rebuildingamerica/atlas-api#typecheck",
  );

  assert.ok(apiTypecheck);
  assert.deepEqual(apiTypecheck.dependencies, [
    "@rebuildingamerica/atlas-api#setup",
  ]);
});

test("packages that publish built output are built before their consumers", () => {
  // A workspace package whose exports resolve into dist/ cannot be bundled
  // from source, so every consumer's build has to wait for it. Without that
  // edge the consumer only builds because a stale dist/ happens to be on
  // disk -- which is true locally and false in Docker and on CI.
  const graph = dryRun("build");
  const manifests = new Map(
    graph.tasks
      .filter((task) => task.directory !== "")
      .map((task) => [
        task.package,
        JSON.parse(
          readFileSync(path.join(task.directory, "package.json"), "utf8"),
        ),
      ]),
  );

  const publishesBuiltOutput = (name) => {
    const manifest = manifests.get(name);
    if (!manifest) return false;
    return JSON.stringify(manifest.exports ?? {}).includes("/dist/");
  };

  const missing = [];
  for (const task of graph.tasks) {
    const manifest = manifests.get(task.package);
    if (!manifest) continue;
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
    };
    for (const [dependency, range] of Object.entries(dependencies)) {
      if (!range.startsWith("workspace:")) continue;
      if (!publishesBuiltOutput(dependency)) continue;
      if (task.dependencies.includes(`${dependency}#build`)) continue;
      missing.push(`${task.taskId} must depend on ${dependency}#build`);
    }
  }

  assert.deepEqual(missing, []);
});
