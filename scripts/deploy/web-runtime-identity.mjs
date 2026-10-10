import { createHmac, randomBytes } from "node:crypto";

/** Compare original credentials privately; callbacks intentionally differ on candidate hosts. */
function normalizedRuntime(runtime) {
  const canonical = runtime.ATLAS_WEB_CANONICAL_URL ?? runtime.ATLAS_PUBLIC_URL;
  const normalized = {
    ...runtime,
    ATLAS_WEB_CANONICAL_URL: canonical,
    ATLAS_PASSKEY_RP_ID:
      runtime.ATLAS_PASSKEY_RP_ID || new URL(canonical).hostname,
  };
  for (const key of [
    "ATLAS_PUBLIC_URL",
    "ATLAS_AUTH_API_KEY_INTROSPECTION_URL",
    "ATLAS_RELEASE_SHA",
    "ATLAS_AUTH_MIGRATIONS",
  ])
    delete normalized[key];
  return Object.fromEntries(
    Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b)),
  );
}
function runtimeDigest(runtime, salt) {
  return createHmac("sha256", salt)
    .update(JSON.stringify(normalizedRuntime(runtime)))
    .digest("hex");
}
export function preserveRuntimeIdentity(runtime, sha, existing) {
  const journal = existing ?? {
    releaseSha: sha,
    runtimeSalt: randomBytes(32).toString("hex"),
  };
  if (
    journal.releaseSha !== sha ||
    !/^[a-f0-9]{64}$/.test(journal.runtimeSalt ?? "")
  )
    throw new Error(
      "Existing runtime journal is missing or belongs to another release.",
    );
  const fingerprint = runtimeDigest(runtime, journal.runtimeSalt);
  if (existing && existing.runtimeDigest !== fingerprint)
    throw new Error(
      "Runtime credentials or configuration changed since candidate publication.",
    );
  return { ...journal, runtimeDigest: fingerprint };
}
