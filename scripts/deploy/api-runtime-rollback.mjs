import { createHash } from "node:crypto";
import { cloudflareCommand } from "./cloudflare-cli.mjs";
import {
  assertRuntimeDeployments,
  runtimeReleaseIdentity,
  sameRuntimeRelease,
} from "./web-assess.mjs";

const ROLES = ["discovery", "api"];
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function releases(input) {
  return Object.fromEntries(
    ["api", "discovery"].map((key) => [
      key,
      runtimeReleaseIdentity(input?.[key]),
    ]),
  );
}
function account(accountId, env) {
  if (
    !/^[a-f0-9]{32}$/.test(accountId ?? "") ||
    env.CLOUDFLARE_ACCOUNT_ID !== accountId
  )
    throw new Error(
      "The rollback account must match the explicit Cloudflare environment account.",
    );
}
function client(cloudflare, env) {
  const run =
    cloudflare ??
    ((command, options) => cloudflareCommand(command, { ...options, env }));
  return (command, options) => {
    try {
      return run(command, options);
    } catch {
      throw new Error(
        "cf rollback operation failed; provider diagnostics were suppressed.",
      );
    }
  };
}
function checkedSnapshot(input) {
  const snapshot = {
    schemaVersion: 1,
    kind: "cloudflare-api-runtime-snapshot",
    accountId: input?.accountId,
    capturedAt: input?.capturedAt,
    runtimeReleases: releases(input?.runtimeReleases),
  };
  if (
    input?.schemaVersion !== snapshot.schemaVersion ||
    input?.kind !== snapshot.kind ||
    !/^[a-f0-9]{32}$/.test(snapshot.accountId ?? "") ||
    !Number.isFinite(Date.parse(snapshot.capturedAt ?? "")) ||
    input.snapshotId !== digest(snapshot)
  )
    throw new Error(
      "The retained snapshot identity does not match its runtime records.",
    );
  return { ...snapshot, snapshotId: input.snapshotId };
}

/** Capture publisher identities while their versions and SQLite namespaces are active. */
export function captureApiRuntimeSnapshot({
  accountId,
  runtimeReleases,
  env = process.env,
  cloudflare,
  now = Date.now,
}) {
  account(accountId, env);
  const identities = releases(runtimeReleases);
  assertRuntimeDeployments(identities, client(cloudflare, env));
  const snapshot = {
    schemaVersion: 1,
    kind: "cloudflare-api-runtime-snapshot",
    accountId,
    capturedAt: new Date(now()).toISOString(),
    runtimeReleases: identities,
  };
  return { ...snapshot, snapshotId: digest(snapshot) };
}

/** Plan version recovery only; namespace/Worker migrations need a separate data-aware plan. */
export function createApiRollbackPlan({ snapshot, current }) {
  snapshot = checkedSnapshot(snapshot);
  current = releases(current);
  for (const role of ROLES) {
    const previous = snapshot.runtimeReleases[role];
    if (
      ["workerName", "namespaceId", "namespaceClass", "storage"].some(
        (key) => previous[key] !== current[role][key],
      )
    )
      throw new Error(
        "Version rollback cannot change a Worker or Durable Object namespace.",
      );
    if (
      previous.workerVersionId === current[role].workerVersionId &&
      !sameRuntimeRelease(previous, current[role])
    )
      throw new Error(
        "One immutable Worker version has conflicting commit or artifact identity.",
      );
  }
  if (
    current.api.workerName === current.discovery.workerName &&
    !sameRuntimeRelease(current.api, current.discovery)
  )
    throw new Error(
      "Shared API/discovery Workers must have one immutable runtime identity.",
    );
  const plan = {
    schemaVersion: 1,
    kind: "cloudflare-api-runtime-rollback",
    snapshot,
    current,
  };
  return { ...plan, planId: digest(plan) };
}

function checkedPlan(input) {
  const plan = createApiRollbackPlan({
    snapshot: input?.snapshot,
    current: input?.current,
  });
  if (
    input.schemaVersion !== plan.schemaVersion ||
    input.kind !== plan.kind ||
    input.planId !== plan.planId
  )
    throw new Error(
      "The rollback plan identity does not match its runtime records.",
    );
  return plan;
}
function checkedJournal(journal, plan) {
  if (!journal)
    return {
      schemaVersion: 1,
      planId: plan.planId,
      phase: "prepared",
      completed: [],
    };
  if (
    journal.schemaVersion !== 1 ||
    journal.planId !== plan.planId ||
    !["prepared", "restoring", "versions-restored", "verified"].includes(
      journal.phase,
    ) ||
    !Array.isArray(journal.completed) ||
    new Set(journal.completed).size !== journal.completed.length ||
    journal.completed.some((key) => !ROLES.includes(key))
  )
    throw new Error(
      "The rollback journal belongs to a different operation or is invalid.",
    );
  return {
    schemaVersion: 1,
    planId: plan.planId,
    phase: journal.phase,
    completed: [...journal.completed],
  };
}

/** Restore retained versions without deleting storage, bypassing checks, or claiming web recovery. */
export async function restoreApiRuntimeSnapshot({
  plan,
  journal,
  apply = false,
  checkpoint,
  probe,
  env = process.env,
  cloudflare,
}) {
  plan = checkedPlan(plan);
  account(plan.snapshot.accountId, env);
  const cf = client(cloudflare, env);
  journal = checkedJournal(journal, plan);
  if (
    apply &&
    (typeof checkpoint !== "function" || typeof probe !== "function")
  )
    throw new Error(
      "Applied rollback requires a durable journal checkpoint and a real hosted journey probe.",
    );
  const previous = plan.snapshot.runtimeReleases;
  const active = {};
  // Validate both roles and every recovery target before the first mutation.
  for (const role of ROLES) {
    const versions = cf([
      "workers",
      "deployments",
      "list",
      "--worker",
      previous[role].workerName,
    ]).deployments?.[0]?.versions;
    if (versions?.length !== 1 || versions[0].percentage !== 100)
      throw new Error(
        "Rollback requires one exact active version for each runtime.",
      );
    const versionId = versions[0].version_id;
    if (versionId === previous[role].workerVersionId)
      active[role] = previous[role];
    else if (
      versionId === plan.current[role].workerVersionId &&
      !journal.completed.includes(role)
    )
      active[role] = plan.current[role];
    else
      throw new Error(
        "An unrelated active runtime prevents automatic rollback.",
      );
    const retained = cf([
      "workers",
      "versions",
      "get",
      previous[role].workerVersionId,
      "--worker-id",
      previous[role].workerName,
    ]);
    if (retained?.id !== previous[role].workerVersionId)
      throw new Error(
        "A retained rollback version is unavailable or has a mismatched identity.",
      );
  }
  assertRuntimeDeployments(active, cf);
  if (!apply)
    return {
      status: "ready",
      planId: plan.planId,
      accountId: plan.snapshot.accountId,
      runtimeReleases: previous,
    };
  try {
    checkpoint(journal);
    for (const role of ROLES) {
      journal = { ...journal, phase: "restoring" };
      checkpoint(journal); // Persist intent before a potentially ambiguous provider write.
      if (!sameRuntimeRelease(active[role], previous[role])) {
        assertRuntimeDeployments({ [role]: active[role] }, cf);
        cf(
          [
            "workers",
            "deployments",
            "create",
            "--worker",
            previous[role].workerName,
          ],
          {
            body: {
              strategy: "percentage",
              versions: [
                { version_id: previous[role].workerVersionId, percentage: 100 },
              ],
            },
          },
        );
      }
      assertRuntimeDeployments({ [role]: previous[role] }, cf);
      for (const key of ROLES)
        if (active[key].workerName === previous[role].workerName)
          active[key] = previous[key];
      journal = {
        ...journal,
        completed: [...new Set([...journal.completed, role])],
      };
      checkpoint(journal);
    }
    assertRuntimeDeployments(previous, cf);
    journal = { ...journal, phase: "versions-restored" };
    checkpoint(journal);
    const report = await probe({
      accountId: plan.snapshot.accountId,
      runtimeReleases: previous,
    });
    if (
      report?.status !== "pass" ||
      typeof report.evidenceReference !== "string" ||
      !report.evidenceReference.trim()
    )
      throw new Error("Restored hosted journeys did not pass.");
    // Probe work must not hide a concurrent redeployment after the first readback.
    assertRuntimeDeployments(previous, cf);
    journal = { ...journal, phase: "verified" };
    checkpoint(journal);
    return {
      status: "api-runtimes-restored",
      planId: plan.planId,
      accountId: plan.snapshot.accountId,
      readbackPassed: true,
      journeysPassed: true,
      evidenceReference: report.evidenceReference,
      runtimeReleases: previous,
    };
  } catch {
    throw new Error(
      "API/discovery rollback stopped; retain its exact plan and journal, verify provider state, and resume explicitly. Provider diagnostics were suppressed.",
    );
  }
}
