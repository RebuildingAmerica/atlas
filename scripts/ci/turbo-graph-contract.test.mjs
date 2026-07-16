import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
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
