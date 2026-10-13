import assert from "node:assert/strict";
import test from "node:test";
import { cleanupPublicationFixtures } from "./hosted-fixture-cleanup.mjs";
const run = {
  id: 38339161713,
  run_attempt: 1,
  status: "completed",
  conclusion: "failure",
  head_repository: { full_name: "RebuildingAmerica/atlas" },
  path: ".github/workflows/deploy-production.yml",
  head_sha: "a".repeat(40),
  head_branch: "v-fixture",
};
const context = {
  repository: "RebuildingAmerica/atlas",
  target: "production",
  operation: "cleanup-hosted-fixtures",
  sha: "b".repeat(40),
};
const env = {
  ATLAS_PUBLIC_URL: "https://atlas.example.org",
  ATLAS_HOSTED_E2E_SECRET: "synthetic-secret",
};
test("cleanup uses the trusted source attempt, repeats guarded cleanup and retains only counts", async () => {
  const calls = [];
  const result = await cleanupPublicationFixtures({
    run,
    context,
    env,
    sourceRun: "38339161713",
    validate: () => {},
    fetch: async (url, options) => {
      calls.push([url, options]);
      return Response.json({
        ok: true,
        runId: "38339161713-1",
        deleted: {
          users: calls.length === 1 ? 2 : 0,
          workspaces: 0,
          identities: 0,
        },
      });
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[0][1].body).runId, "38339161713-1");
  assert.equal(result.status, "verified-clean");
  assert.equal(result.deleted.users, 2);
  assert.ok(!JSON.stringify(result).includes("synthetic-secret"));
});
test("cleanup rejects invalid attempts before any request", async () => {
  await assert.rejects(
    cleanupPublicationFixtures({
      run: { ...run, run_attempt: 0 },
      context,
      env,
      sourceRun: "38339161713",
      validate: () => {},
      fetch: () => {
        throw Error("must not call");
      },
    }),
    /attempt/,
  );
});
test("cleanup requires successful empty repeat readback and suppresses response details", async () => {
  await assert.rejects(
    cleanupPublicationFixtures({
      run,
      context,
      env,
      sourceRun: "38339161713",
      validate: () => {},
      fetch: async () =>
        Response.json({ error: "private-value" }, { status: 503 }),
    }),
    (error) =>
      /could not be verified/.test(error.message) &&
      !error.message.includes("private-value"),
  );
});
