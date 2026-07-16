import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
