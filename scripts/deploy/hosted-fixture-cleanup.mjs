/** Remove only the synthetic identities owned by a completed protected publisher attempt.
 * The existing application helper verifies workspace, billing and PDS ownership.
 * A second empty cleanup proves idempotency without rerunning account creation. */
export class HostedFixtureCleanupError extends Error {
  constructor(stage, httpStatus) {
    if (
      !["source-run", "authority", "request", "response", "readback"].includes(
        stage,
      )
    )
      throw new Error("Unknown cleanup failure stage.");
    super(
      `Hosted fixture cleanup could not be verified: ${stage === "source-run" ? "source run or attempt" : stage}.`,
    );
    this.stage = stage;
    if (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599)
      this.httpStatus = httpStatus;
  }
}

export async function cleanupPublicationFixtures({
  run,
  context,
  env,
  sourceRun,
  validate,
  fetch = globalThis.fetch,
}) {
  try {
    validate(run, context, {
      runId: sourceRun,
      previous: true,
      recovery: true,
    });
  } catch {
    throw new HostedFixtureCleanupError("source-run");
  }
  if (!Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1)
    throw new HostedFixtureCleanupError("source-run");
  const runId = `${sourceRun}-${run.run_attempt}`;
  if (!/^\d{6,20}-\d{1,4}$/.test(runId))
    throw new HostedFixtureCleanupError("source-run");
  let origin;
  try {
    origin = new URL(env.ATLAS_PUBLIC_URL);
  } catch {
    throw new HostedFixtureCleanupError("authority");
  }
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    !env.ATLAS_HOSTED_E2E_SECRET?.trim()
  )
    throw new HostedFixtureCleanupError("authority");
  const headers = {
    "content-type": "application/json",
    "x-atlas-hosted-e2e-secret": env.ATLAS_HOSTED_E2E_SECRET,
  };
  if (
    env.ATLAS_HOSTED_CF_ACCESS_CLIENT_ID &&
    env.ATLAS_HOSTED_CF_ACCESS_CLIENT_SECRET
  ) {
    headers["CF-Access-Client-Id"] = env.ATLAS_HOSTED_CF_ACCESS_CLIENT_ID;
    headers["CF-Access-Client-Secret"] =
      env.ATLAS_HOSTED_CF_ACCESS_CLIENT_SECRET;
  }
  let deleted;
  let stage = "request";
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      stage = "request";
      const response = await fetch(
        new URL("/api/e2e/hosted/identity", origin),
        {
          method: "POST",
          redirect: "error",
          headers,
          body: JSON.stringify({ action: "cleanup", runId }),
          signal: AbortSignal.timeout(120000),
        },
      );
      if (!response.ok)
        throw new HostedFixtureCleanupError("response", response.status);
      stage = "readback";
      const result = await response.json();
      if (
        result.ok !== true ||
        result.runId !== runId ||
        !result.deleted ||
        !["users", "workspaces", "identities"].every(
          (key) =>
            Number.isSafeInteger(result.deleted[key]) &&
            result.deleted[key] >= 0,
        ) ||
        (attempt === 1 &&
          Object.values(result.deleted).some((value) => value !== 0))
      )
        throw new HostedFixtureCleanupError("readback");
      if (attempt === 0)
        deleted = Object.fromEntries(
          ["users", "workspaces", "identities"].map((key) => [
            key,
            result.deleted[key],
          ]),
        );
    }
  } catch (error) {
    if (error instanceof HostedFixtureCleanupError) throw error;
    throw new HostedFixtureCleanupError(stage);
  }
  return {
    status: "verified-clean",
    runId,
    deleted,
    repeatDeleted: { users: 0, workspaces: 0, identities: 0 },
    verifiedAt: new Date().toISOString(),
  };
}
