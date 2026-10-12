import { canonicalDigest } from "./canonical-digest.mjs";
import { sameRuntimeRelease } from "./web-assess.mjs";

const ID = /^[a-f0-9]{32}$/;
const VERSION = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export function matchesHost(pattern, hostname) {
  const clean = pattern.replace(/^https?:\/\//, "").split("/")[0];
  const escaped = clean
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`, "i").test(hostname);
}

export function routingIdentity(manifest, zoneId, publicHostname) {
  return {
    releaseSha: manifest.releaseSha,
    accountId: manifest.accountId,
    zoneId,
    publicHostname,
    operationsHostname: manifest.operations.hostname,
    workerName: manifest.operations.workerName,
    workerVersionId: manifest.operations.workerVersionId,
    artifactDigest: manifest.operations.artifactDigest,
  };
}

export function assertRoutingContinuity(journal, identity) {
  const { routes: originalRoutes, ...original } = journal?.snapshot ?? {};
  if (
    journal?.schemaVersion !== 1 ||
    journal.phase !== "verified" ||
    !ID.test(journal.routeId ?? "") ||
    journal.operationId !== canonicalDigest(original) ||
    journal.snapshotDigest !== canonicalDigest(journal.snapshot) ||
    !/^[a-f0-9]{40}$/.test(original.releaseSha ?? "") ||
    !VERSION.test(original.workerVersionId ?? "") ||
    !/^[a-f0-9]{64}$/.test(original.artifactDigest ?? "") ||
    [
      "accountId",
      "zoneId",
      "publicHostname",
      "operationsHostname",
      "workerName",
    ].some((key) => original[key] !== identity[key]) ||
    !Array.isArray(originalRoutes) ||
    originalRoutes.some((row) =>
      matchesHost(row.pattern, identity.publicHostname),
    )
  )
    throw Error(
      "The original canonical API routing journal is invalid or its ownership differs.",
    );
}

/** A previous cutover flag cannot certify that today's profiles reach the current API pair. */
export function assertCurrentApiRoutingReceipt({
  manifest,
  receipt,
  journal,
  zoneId,
  publicHostname,
  now = Date.now(),
}) {
  const fail = () => {
    throw Error(
      "Fresh canonical API routing proof for the exact current runtime pair is required.",
    );
  };
  if (
    !manifest?.operations ||
    manifest.target !== "production" ||
    !["verified-active", "verified-paused"].includes(manifest.status)
  )
    fail();
  const identity = routingIdentity(manifest, zoneId, publicHostname);
  assertRoutingContinuity(journal, identity);
  const verifiedAt = Date.parse(receipt?.verifiedAt ?? "");
  if (
    receipt?.schemaVersion !== 1 ||
    receipt.kind !== "cloudflare-api-routing-verification" ||
    receipt.status !== "verified-canonical" ||
    Object.entries(identity).some(([key, value]) => receipt[key] !== value) ||
    receipt.routeId !== journal.routeId ||
    receipt.routingJournalDigest !== canonicalDigest(journal) ||
    !Number.isFinite(verifiedAt) ||
    !Number.isFinite(now) ||
    verifiedAt > now ||
    now - verifiedAt > 600_000
  )
    fail();
  try {
    for (const role of ["api", "discovery"])
      if (
        manifest.runtimeReleases?.[role]?.releaseSha !== manifest.releaseSha ||
        !sameRuntimeRelease(
          manifest.runtimeReleases?.[role],
          receipt.runtimeReleases?.[role],
        )
      )
        fail();
  } catch {
    fail();
  }
  return receipt;
}
