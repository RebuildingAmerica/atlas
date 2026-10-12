import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  findProductionValidation,
  REQUIRED_PRODUCTION_JOBS,
} from "./production-validation.mjs";

const repository = "RebuildingAmerica/atlas";
const sha = "a".repeat(40);
const run = {
  id: 41,
  head_sha: sha,
  repository: { full_name: repository },
  head_repository: { full_name: repository },
  path: ".github/workflows/deploy-production.yml",
  event: "workflow_dispatch",
  status: "completed",
  conclusion: "failure",
  run_attempt: 2,
};
const passed = () =>
  REQUIRED_PRODUCTION_JOBS.map((name, i) => ({
    id: i + 1,
    name,
    status: "completed",
    conclusion: "success",
  }));

function api(runs = [run], jobs = passed()) {
  const calls = [];
  return {
    calls,
    async request(path) {
      calls.push(path);
      if (path.includes("/attempts/2/jobs"))
        return { total_count: jobs.length, jobs };
      assert.match(path, /deploy-production\.yml\/runs\?head_sha=/);
      return { workflow_runs: runs };
    },
  };
}
const find = (service) =>
  findProductionValidation({
    repository,
    sha,
    currentRunId: 42,
    request: service.request,
  });

test("the reuse contract includes every full production CI job", () => {
  const source = readFileSync(
    new URL("../../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const jobs = source.slice(source.indexOf("\njobs:\n"));
  const names = [...jobs.matchAll(/^  ([a-z][a-z0-9-]+):$/gm)].map(
    (match) => `ci / ${match[1]}`,
  );
  assert.deepEqual(
    [...REQUIRED_PRODUCTION_JOBS].sort(),
    ["guard-production-ref", ...names].sort(),
  );
});

test("reuse exact-source full production validation when only publication failed", async () => {
  const service = api();
  assert.deepEqual(await find(service), { runId: 41, runAttempt: 2 });
  assert.match(service.calls[1], /runs\/41\/attempts\/2\/jobs/);
});

test("overall run success cannot hide missing, skipped, failed or duplicate CI jobs", async () => {
  for (const conclusion of ["skipped", "failure", "cancelled"]) {
    const jobs = passed();
    jobs[1].conclusion = conclusion;
    assert.equal(
      await find(api([{ ...run, conclusion: "success" }], jobs)),
      null,
    );
  }
  assert.equal(await find(api([run], passed().slice(1))), null);
  assert.equal(await find(api([run], [...passed(), passed()[0]])), null);
});

test("reject unrelated source, repository, workflow, event and current run", async () => {
  for (const change of [
    { head_sha: "b".repeat(40) },
    { repository: { full_name: "elsewhere/atlas" } },
    { head_repository: { full_name: "elsewhere/atlas" } },
    { path: ".github/workflows/ci.yml" },
    { event: "pull_request" },
    { status: "in_progress" },
    { id: 42 },
  ]) {
    const service = api([{ ...run, ...change }]);
    assert.equal(await find(service), null);
    assert.equal(service.calls.length, 1);
  }
});

test("read every job page before accepting production validation", async () => {
  const service = api();
  const request = async (path) => {
    if (!path.includes("/jobs")) return service.request(path);
    const page = new URL(`https://api.github.com${path}`).searchParams.get(
      "page",
    );
    return {
      total_count: 100 + passed().length,
      jobs:
        page === "1"
          ? Array.from({ length: 100 }, (_, i) => ({ name: `unrelated-${i}` }))
          : passed(),
    };
  };
  assert.deepEqual(
    await findProductionValidation({
      repository,
      sha,
      currentRunId: 42,
      request,
    }),
    { runId: 41, runAttempt: 2 },
  );
});

test("API and malformed provider responses fail closed rather than rerunning CI", async () => {
  await assert.rejects(
    find({
      request: async () => {
        throw Error("unavailable");
      },
    }),
    /unavailable/,
  );
  await assert.rejects(find({ request: async () => ({}) }), /workflow runs/);
});
