import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { apiSettingsFromService } from "./api-cloudflare-settings.mjs";
import {
  deployReleaseArtifact,
  publishApiRelease,
} from "./api-cloudflare-release.mjs";
import { createApiRollbackPlan } from "./api-runtime-rollback.mjs";
import { digestDirectory } from "./web-release.mjs";

/** Keep account identity canonical while validating workspace callbacks privately. */
export function callbackSettings({ service, runtime, origin, access }) {
  const settings = apiSettingsFromService(service, runtime);
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw Error("An exact HTTPS callback origin is required.");
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== origin ||
    url.username ||
    url.password
  )
    throw Error("An exact HTTPS callback origin is required.");
  const canonical = runtime.ATLAS_WEB_CANONICAL_URL ?? runtime.ATLAS_PUBLIC_URL;
  for (const key of [
    "ATLAS_AUTH_MEMBERSHIP_URL",
    "ATLAS_AUTH_API_KEY_INTROSPECTION_URL",
  ]) {
    const callback = new URL(settings[key]);
    if (callback.origin !== canonical || callback.username || callback.password)
      throw Error(
        "Original callbacks must belong to the canonical web origin.",
      );
    settings[key] = `${origin}${callback.pathname}${callback.search}`;
  }
  for (const key of ["ORIGIN", "CLIENT_ID", "CLIENT_SECRET"])
    delete settings[`ATLAS_CALLBACK_ACCESS_${key}`];
  if (origin !== canonical) {
    if (!access?.client_id?.trim() || !access?.client_secret?.trim())
      throw Error("Existing candidate Access credentials are required.");
    settings.ATLAS_CALLBACK_ACCESS_ORIGIN = origin;
    settings.ATLAS_CALLBACK_ACCESS_CLIENT_ID = access.client_id;
    settings.ATLAS_CALLBACK_ACCESS_CLIENT_SECRET = access.client_secret;
  }
  return settings;
}

/** Use the ordinary paused-pair publisher and its immutable version/rollback checks. */
export async function publishCallbackConfiguration({
  previous,
  artifactDirectory,
  directory,
  service,
  runtime,
  origin,
  access,
  env,
  checkpoint,
  cloudflare,
  publish = publishApiRelease,
}) {
  const settings = callbackSettings({ service, runtime, origin, access });
  mkdirSync(directory, { recursive: true });
  const artifacts = Object.fromEntries(
    ["api", "discovery"].map((role) => {
      const destination = join(directory, role);
      cpSync(join(artifactDirectory, role), destination, { recursive: true });
      return [
        role,
        {
          directory: destination,
          artifactDigest: digestDirectory(
            join(destination, ".cloudflare/output/v0"),
          ),
        },
      ];
    }),
  );
  const schemaResult = JSON.parse(
    readFileSync(join(artifactDirectory, "schema-doctor.json"), "utf8"),
  );
  for (const file of [
    "operations",
    "schema-doctor.json",
    "schema-receipt.json",
  ])
    cpSync(join(artifactDirectory, file), join(directory, file), {
      recursive: true,
    });
  const manifest = await publish({
    target: previous.target,
    releaseSha: previous.releaseSha,
    accountId: previous.accountId,
    provenance: previous.provenance,
    schemaResult,
    artifacts,
    previous,
    env,
    cloudflare,
    apply: true,
    deploy: async (_role, artifact, identity) =>
      deployReleaseArtifact(artifact, { ...identity, settings, env }),
    probe: async ({ role, path }) => {
      const response = await fetch(
        `https://${previous.operations.hostname}/${role}${path}`,
        {
          headers: {
            "CF-Access-Client-Id": access.client_id,
            "CF-Access-Client-Secret": access.client_secret,
          },
          redirect: "manual",
          signal: AbortSignal.timeout(30000),
        },
      );
      let body = null;
      try {
        body = await response.json();
      } catch {}
      return { status: response.status, body };
    },
    checkpoint: async (journal) => {
      writeFileSync(
        join(directory, "release-journal.json"),
        JSON.stringify(journal, null, 2) + "\n",
      );
      await checkpoint(journal);
    },
  });
  manifest.operations = previous.operations;
  // Retain the original rollback target across candidate and canonical settings.
  if (previous.rollbackPlan)
    manifest.rollbackPlan = createApiRollbackPlan({
      snapshot: previous.rollbackPlan.snapshot,
      current: manifest.runtimeReleases,
    });
  const journal = {
    schemaVersion: 1,
    phase: "verified-paused",
    updatedAt: manifest.verifiedAt,
    manifest,
  };
  for (const [file, value] of Object.entries({
    "api-release.json": manifest,
    "release-journal.json": journal,
    "api-rollback-plan.json": manifest.rollbackPlan,
  }))
    writeFileSync(join(directory, file), JSON.stringify(value, null, 2) + "\n");
  await checkpoint(journal);
  return manifest;
}
