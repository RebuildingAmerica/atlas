import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Full production validation protects browsing, account access and billing.
// A failed publication does not invalidate successful checks of immutable source.
export const REQUIRED_PRODUCTION_JOBS = [
  "guard-production-ref",
  "ci / changes",
  "ci / test",
  "ci / acceptance",
  "ci / quality",
  "ci / stripe-acceptance",
  "ci / deploy-scripts",
  "ci / openapi-drift",
  "ci / actions-lint",
  "ci / contract",
  "ci / docs",
  "ci / compose-validate",
  "ci / secrets-scan",
];

export async function findProductionValidation({
  repository,
  sha,
  currentRunId,
  request,
}) {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") ||
    !/^[a-f0-9]{40}$/.test(sha ?? "") ||
    !Number.isSafeInteger(currentRunId) ||
    currentRunId <= 0
  ) {
    throw Error(
      "Explicit repository, immutable SHA and current run ID are required.",
    );
  }
  const root = `/repos/${repository}/actions`;
  for (let page = 1; page <= 10; page++) {
    const result = await request(
      `${root}/workflows/deploy-production.yml/runs?head_sha=${sha}&event=workflow_dispatch&status=completed&per_page=100&page=${page}`,
    );
    if (!Array.isArray(result?.workflow_runs))
      throw Error("Invalid GitHub workflow runs response.");
    for (const run of result.workflow_runs) {
      if (
        run.id === currentRunId ||
        !Number.isSafeInteger(run.id) ||
        run.head_sha !== sha ||
        run.repository?.full_name !== repository ||
        run.head_repository?.full_name !== repository ||
        run.path !== ".github/workflows/deploy-production.yml" ||
        run.event !== "workflow_dispatch" ||
        run.status !== "completed" ||
        !Number.isSafeInteger(run.run_attempt) ||
        run.run_attempt < 1
      )
        continue;
      const jobs = [];
      for (let jobPage = 1; jobPage <= 10; jobPage++) {
        const response = await request(
          `${root}/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${jobPage}`,
        );
        if (!Array.isArray(response?.jobs))
          throw Error("Invalid GitHub workflow jobs response.");
        jobs.push(...response.jobs);
        if (response.jobs.length < 100) break;
        if (jobPage === 10)
          throw Error(
            "Production validation job lookup exceeded its bounded pagination.",
          );
      }
      if (
        REQUIRED_PRODUCTION_JOBS.every((name) => {
          const matches = jobs.filter((job) => job.name === name);
          return (
            matches.length === 1 &&
            matches[0].status === "completed" &&
            matches[0].conclusion === "success"
          );
        })
      )
        return { runId: run.id, runAttempt: run.run_attempt };
    }
    if (result.workflow_runs.length < 100) return null;
  }
  throw Error(
    "Production validation run lookup exceeded its bounded pagination.",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const token = process.env.GH_TOKEN;
    if (!token || !process.env.GITHUB_OUTPUT)
      throw Error("The normal Actions token and output file are required.");
    const validation = await findProductionValidation({
      repository: process.env.GITHUB_REPOSITORY,
      sha: process.env.GITHUB_SHA,
      currentRunId: Number(process.env.GITHUB_RUN_ID),
      request: async (path) => {
        const response = await fetch(`https://api.github.com${path}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok)
          throw Error(
            `GitHub validation lookup failed (HTTP ${response.status}).`,
          );
        return response.json();
      },
    });
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `reuse-ci=${Boolean(validation)}\nvalidated-run-id=${validation?.runId ?? ""}\n`,
    );
    console.log(
      validation
        ? `Reusing all full production CI checks for ${process.env.GITHUB_SHA} from run ${validation.runId}, attempt ${validation.runAttempt}.`
        : "No successful full production validation exists for this SHA; run it once.",
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
