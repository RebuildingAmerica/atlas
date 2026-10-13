#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { assertDurableBudget, sameRuntimeRelease } from "./web-assess.mjs";
import { assertCurrentApiRoutingReceipt } from "./api-routing-receipt.mjs";
import {
  cloudflareCommand,
  CloudflareCommandError,
  cloudflareCredentialKind,
} from "./cloudflare-cli.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const RETAINED_SOURCE_IDENTITY_ERROR =
  "Retained artifacts require a completed trusted publication run with the expected source identity.";

const PUBLICATION_STAGES = new Set([
  "billing-preflight",
  "evidence-validation",
  "cloudflare-subscriptions-read",
  "cloudflare-hyperdrive-read",
  "cloudflare-access-read",
  "native-dependencies",
  "api-schema",
  "api-verify",
  "api-routing-verify",
  "web-runtime-identity",
  "web-runtime-prepare",
  "web-build",
  "web-auth-migration",
  "web-artifact-copy",
  "web-publish",
  "web-callback-configuration",
  "web-archive",
  "web-observe",
  "web-hosted-journeys",
]);

/** Accept only the schema command's credential-free failure contract. */
export function schemaFailureDiagnostic(output) {
  try {
    const value = JSON.parse(String(output).trim());
    if (
      Object.keys(value).sort().join(",") !==
        "errorType,phase,schemaRelease,sqlstate" ||
      value.schemaRelease !== "failed" ||
      !/^(configuration|connect|transaction|release-lock|receipt-table|receipt-read|activity-read|catalog-read|migration|schema-apply|receipt-write|commit|unknown)$/.test(
        value.phase,
      ) ||
      !/^[A-Za-z]{1,64}$/.test(value.errorType) ||
      !(value.sqlstate === null || /^[0-9A-Z]{5}$/.test(value.sqlstate))
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

/** Retain a recovery boundary without exposing provider output or customer settings. */
export function publicationStage(directory, stage, action) {
  if (!PUBLICATION_STAGES.has(stage)) throw Error("Unknown publication stage.");
  const record = (status) =>
    appendFileSync(
      join(directory, "publication-diagnostics.jsonl"),
      `${JSON.stringify({ stage, status })}\n`,
      { mode: 0o600 },
    );
  record("running");
  try {
    const result = action();
    if (result && typeof result.then === "function")
      return result.then(
        (value) => {
          record("pass");
          return value;
        },
        (error) => {
          record("fail");
          throw error;
        },
      );
    record("pass");
    return result;
  } catch (error) {
    record("fail");
    throw error;
  }
}
const OPERATIONS = [
  "doctor",
  "publish-api",
  "publish-admin",
  "verify-api",
  "activate-api",
  "pause-api",
  "promote-api",
  "restore-api",
  "web-candidate",
  "promote-web",
  "finalize-web",
  "restore-routing",
];

/** Identify failed hosted assertions without publishing test bodies or credentials. */
const hostedReportFile = join(ROOT, "app/test-results/hosted-results.json");
const hostedCatalogSteps = new Set([
  "direct API catalog",
  "public app catalog",
  "direct API catalog, read again",
  "public app map",
  "public app entity detail",
]);

/** Publish only code locations, fixed request labels and numeric timing/status. */
export function hostedFailureReport(report) {
  const failures = [];
  const visit = (suite) => {
    for (const spec of suite?.specs ?? []) {
      const file = /(?:^|\/)([a-z0-9-]+-hosted\.spec\.ts)$/.exec(
        spec.file ?? "",
      );
      if (!file || !Number(spec.line) || !Number(spec.column)) continue;
      for (const test of spec.tests ?? [])
        for (const result of test.results ?? []) {
          if (!["failed", "timedOut", "interrupted"].includes(result.status))
            continue;
          const location = result.errorLocation;
          const precise =
            location?.file?.endsWith(`/${file[1]}`) &&
            Number(location.line) &&
            Number(location.column);
          const steps = (result.steps ?? [])
            .filter((step) => hostedCatalogSteps.has(step.title))
            .map((step) => {
              const summary = {
                name: step.title,
                durationMs: step.duration < 0 ? null : step.duration,
                failed: Boolean(step.error) || step.duration < 0,
                ...(step.duration < 0 ? { unfinished: true } : {}),
              };
              const message = String(step.error?.message ?? "").replace(
                /\u001b\[[0-9;]*m/g,
                "",
              );
              const status =
                /Expected:\s*200\s+Received:\s*([1-5]\d{2})\b/.exec(message);
              if (status) summary.httpStatus = Number(status[1]);
              return summary;
            });
          const message = String(result.error?.message ?? "");
          const httpStatus =
            /Expected:\s*<\s*400\s+Received:\s*([1-5]\d{2})\b/.exec(
              message.replace(/\u001b\[[0-9;]*m/g, ""),
            );
          const helperFailures = {
            "Hosted E2E is unavailable.": "hosted-helper-unavailable",
            "Hosted E2E cleanup is unavailable.": "hosted-cleanup-unavailable",
            "Hosted E2E preparation and cleanup could not be verified.":
              "hosted-prepare-cleanup-failed",
            "Hosted E2E preparation failed; temporary accounts were removed.":
              "hosted-prepare-failed-cleaned",
            "Hosted E2E cleanup could not be verified.":
              "hosted-cleanup-unverified",
          };
          const reason = Object.entries(helperFailures).find(([text]) =>
            message.includes(JSON.stringify({ error: text })),
          )?.[1];
          failures.push({
            file: `app/tests/e2e/${file[1]}`,
            line: precise ? Number(location.line) : Number(spec.line),
            column: precise ? Number(location.column) : Number(spec.column),
            status: result.status,
            kind:
              result.status === "timedOut"
                ? "timeout"
                : /fetch failed|ECONNRESET|ETIMEDOUT/.test(message)
                  ? "network"
                  : /expect\(|Expected:|AssertionError/.test(message)
                    ? "assertion"
                    : "error",
            durationMs: result.duration,
            steps,
            ...(httpStatus ? { httpStatus: Number(httpStatus[1]) } : {}),
            ...(reason ? { reason } : {}),
          });
        }
    }
    for (const child of suite?.suites ?? []) visit(child);
  };
  visit(report);
  return failures;
}

export function hostedFailureLocations(output) {
  const locations = [];
  const seen = new Set();
  const add = (path, line, column) => {
    const file = /(?:^|\/)tests\/e2e\/([a-z0-9-]+-hosted\.spec\.ts)$/.exec(
      path,
    );
    if (!file || !Number(line) || !Number(column)) return;
    const location = {
      file: `app/tests/e2e/${file[1]}`,
      line: Number(line),
      column: Number(column),
    };
    const key = JSON.stringify(location);
    if (!seen.has(key)) {
      seen.add(key);
      locations.push(location);
    }
  };
  for (const match of output.matchAll(/::error ([^\n]*?)::/g)) {
    const fields = Object.fromEntries(
      match[1].split(",").map((field) => {
        const separator = field.indexOf("=");
        return [field.slice(0, separator), field.slice(separator + 1)];
      }),
    );
    if (fields.file && fields.line && fields.col)
      add(fields.file, fields.line, fields.col);
  }
  for (const match of output.matchAll(
    /((?:[^\s()]+\/)?tests\/e2e\/[a-z0-9-]+-hosted\.spec\.ts):(\d+):(\d+)/g,
  ))
    add(match[1], match[2], match[3]);
  return locations;
}

/** Make release outcomes understandable without exposing provider responses. */
export function publicationSummary({
  env,
  report,
  failed = false,
  error,
  directory = join(ROOT, ".atlas/cloudflare-release"),
}) {
  const target =
    env.ATLAS_PUBLICATION_TARGET === "production"
      ? "Production"
      : env.ATLAS_PUBLICATION_TARGET === "staging"
        ? "Staging"
        : "Unknown environment";
  const operation = OPERATIONS.includes(env.ATLAS_PUBLICATION_OPERATION)
    ? env.ATLAS_PUBLICATION_OPERATION
    : "unknown operation";
  if (operation === "publish-admin" && !failed)
    return `${target} admin publication prepared for the existing deployment action. Public frontend and API remain unchanged.`;
  if (operation === "doctor")
    return `${target} configuration check: ${!failed && report?.status === "pass" ? "passed" : "failed"}.\nNothing deployed. ${target} health was not checked.\nDetails: doctor.json.`;
  if (!failed) {
    const outcomes = {
      "publish-api":
        "Uploaded API/discovery Workers with consumers paused. Public routing was not promoted.",
      "verify-api":
        "Verified the paused API/discovery Workers. Public routing was not promoted.",
      "activate-api": "Activated API/discovery consumers.",
      "pause-api": "Paused API/discovery consumers.",
      "promote-api":
        "Promoted public API routing and passed its hosted checks.",
      "restore-api":
        "Removed the recorded public API Worker route. Previous-origin health was not checked.",
      "web-candidate":
        "Published a protected web candidate and passed hosted journey checks.",
      "promote-web": "Promoted web routing after hosted journey checks.",
      "finalize-web":
        "Finalized canonical callbacks for the already accepted frozen live release. Retained failed automated results remain unchanged.",
      "restore-routing": "Restored previous web routing.",
    };
    return `${target} ${operation}: completed.\n${outcomes[operation] ?? "No recognized release operation was reported."}\nDetails: publication.json.`;
  }
  const labels = {
    "billing-preflight": "Existing customer billing access",
    "evidence-validation": "Release evidence and budget",
    "cloudflare-subscriptions-read": "Cloudflare subscription access",
    "cloudflare-hyperdrive-read": "Cloudflare database connection access",
    "cloudflare-access-read": "Cloudflare Access configuration",
    "native-dependencies": "Python native dependencies",
    "api-schema": "PostgreSQL schema release",
    "api-verify": "API/discovery runtime verification",
    "web-runtime-identity": "Exact API and discovery runtime identity",
    "web-runtime-prepare": "Protected web runtime preparation",
    "web-build": "Workers application build",
    "web-auth-migration": "Authentication database release migration",
    "web-artifact-copy": "Web release artifact preparation",
    "web-publish": "Protected web Worker publication",
    "web-archive": "Immutable web release archive",
    "web-observe": "Deployed web runtime observation",
    "web-hosted-journeys": "Hosted sign-in, workspace and billing checks",
  };
  let boundary = "No safe failure boundary was recorded.";
  let details = "publication.json and release journals";
  if (
    error instanceof Error &&
    error.message === RETAINED_SOURCE_IDENTITY_ERROR
  ) {
    boundary = "Retained publication source identity";
    details =
      "Check the source run's repository, workflow, result and required relationship to this release commit";
  }
  try {
    const current = read(join(directory, "publication.json"));
    if (
      /^\d+$/.test(env.GITHUB_RUN_ID ?? "") &&
      current.runId === env.GITHUB_RUN_ID &&
      current.operation === operation
    ) {
      const failures = (name, root = directory) =>
        readFileSync(join(root, name), "utf8")
          .trim()
          .split("\n")
          .map(JSON.parse)
          .filter((entry) => ["fail", "failed"].includes(entry.status));
      const stage = failures("publication-diagnostics.jsonl").findLast(
        (entry) => PUBLICATION_STAGES.has(entry.stage),
      )?.stage;
      if (stage) {
        boundary = labels[stage];
        details = "publication-diagnostics.jsonl";
        if (stage === "api-verify") {
          const api = {
            "operations-access": "API operations Access policy",
            "operations-domain": "API operations hostname",
            "operations-denial": "API operations anonymous denial",
            "discovery-version": "Retained discovery version",
            "api-version": "Retained API version",
            "runtime-deployments-before":
              "Active API/discovery versions before probes",
            "discovery-probes": "Protected discovery runtime probes",
            "api-probes": "Protected API runtime probes",
            "runtime-deployments-after":
              "Active API/discovery versions after probes",
            "runtime-snapshot": "Rollback snapshot readback",
          };
          const apiDirectory = releasePath(
            directory,
            current.pendingApiDirectory ?? current.apiDirectory,
          );
          const entry = failures(
            "verification-diagnostics.jsonl",
            apiDirectory,
          ).findLast(
            (entry) =>
              entry.runId === env.GITHUB_RUN_ID &&
              Object.hasOwn(api, entry.stage),
          );
          if (entry) {
            boundary = api[entry.stage];
            details = "API release verification-diagnostics.jsonl";
          }
        }
        if (stage === "billing-preflight") {
          details = "billing-diagnostics.jsonl";
          const billing = {
            inputs: "Required billing settings",
            "catalog-read": "Stripe catalog read",
            "catalog-validation": "Stripe catalog validation",
            "portal-read": "Stripe customer portal configuration",
          };
          const entry = failures(details).findLast((entry) =>
            Object.hasOwn(billing, entry.stage),
          );
          if (entry) boundary = billing[entry.stage];
        }
      }
    }
  } catch {
    // Early failures may precede artifact creation. Never print private parse errors.
  }
  return `${target} ${operation}: failed.\nFailed check: ${boundary}\nThis attempt did not complete. Production health is unverified.\nDetails: ${details}.`;
}
const parseJson = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    throw Error("Publication JSON is invalid; private content suppressed.");
  }
};
const read = (file) => parseJson(readFileSync(file, "utf8"));
const required = (env, key) => {
  if (!env[key]?.trim())
    throw Error(
      `${key} is required; existing deployment settings must be supplied explicitly.`,
    );
  return env[key];
};

/** Reuse CI's existing values; never regenerate account, billing or PDS credentials. */
export function assemblePublicationSettings(env) {
  const canonical = required(env, "ATLAS_PUBLIC_URL").replace(/\/$/, "");
  const apiOrigin = required(env, "ATLAS_API_URL").replace(/\/$/, "");
  const runtime = env.ATLAS_WEB_RUNTIME_ENV_JSON
    ? parseJson(env.ATLAS_WEB_RUNTIME_ENV_JSON)
    : {
        NODE_ENV: "production",
        DATABASE_BACKEND: "postgres",
        ATLAS_MANAGED: "true",
        ATLAS_MULTI_USER: "true",
        ATLAS_PUBLIC_URL: canonical,
        ATLAS_SERVER_API_PROXY_TARGET: apiOrigin,
        ATLAS_AUTH_BASE_PATH: "/api/auth",
        ATLAS_AUTH_JWT_AUDIENCES: `${canonical}/mcp,${apiOrigin}`,
        ATLAS_AUTH_API_KEY_INTROSPECTION_URL: `${canonical}/api/auth/internal/api-key`,
        ATLAS_AUTH_MEMBERSHIP_URL: canonical,
        ATLAS_EMAIL_PROVIDER: "resend",
        ...Object.fromEntries(
          [
            "DATABASE_URL",
            "ATLAS_AUTH_INTERNAL_SECRET",
            "ATLAS_AUTH_CALLBACK_SECRET",
            "ATLAS_EDGE_ORIGIN_SECRET",
            "ATLAS_ADMIN_PUBLIC_URL",
            "ATLAS_EMAIL_RESEND_API_KEY",
            "ATLAS_PDS_PUBLIC_URL",
            "ATLAS_PDS_INVITE_BROKER_URL",
            "ATLAS_PDS_INVITE_BROKER_SECRET",
            "ATLAS_INSTANCE_OPERATOR_EMAILS",
            "ATLAS_PLATFORM_OPERATOR_EMAILS",
            "ATLAS_BILLING_CHECKOUT_ENABLED",
            "ATLAS_BILLING_AUTOMATIC_TAX",
            "ATLAS_PAID_ACCESS_MODE",
          ].map((key) => [key, required(env, key)]),
        ),
        ...Object.fromEntries(
          [
            "ATLAS_DOCS_URL",
            "ATLAS_EMAIL_FROM",
            "ATLAS_PASSKEY_RP_ID",
            "ATLAS_SAML_ALLOWED_ISSUERS",
            "ATLAS_SAML_SP_PRIVATE_KEY",
            "ATLAS_SAML_SP_PRIVATE_KEY_PASS",
            "ATLAS_OAUTH_CIMD_DOMAIN_ALLOWLIST",
            "STRIPE_API_KEY",
            "STRIPE_WEBHOOK_SECRET",
            "STRIPE_ATLAS_CATALOG",
            "STRIPE_BILLING_PORTAL_CONFIGURATION",
            "ATLAS_BILLING_ALLOWED_OFFERS",
          ]
            .filter((key) => env[key]?.trim())
            .map((key) => [key, env[key]]),
        ),
      };
  if (runtime.ATLAS_BILLING_CHECKOUT_ENABLED === "true")
    for (const key of [
      "STRIPE_API_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_ATLAS_CATALOG",
    ])
      required(runtime, key);
  if (env.ATLAS_API_SETTINGS_EXPORT_JSON)
    return { runtime, service: parseJson(env.ATLAS_API_SETTINGS_EXPORT_JSON) };
  // Preserve the exact issuer kinds/actions of the former trusted CI deployment.
  // Closed Google billing does not authorize silently changing machine identities.
  let issuers;
  if (env.ATLAS_MACHINE_TRUSTED_ISSUERS?.trim())
    issuers = parseJson(env.ATLAS_MACHINE_TRUSTED_ISSUERS);
  else {
    const account = required(env, "GCP_SERVICE_ACCOUNT");
    const match = /^[^@]+@([a-z0-9-]+)\.iam\.gserviceaccount\.com$/.exec(
      account,
    );
    if (!match)
      throw Error(
        "Existing scheduler project identity is invalid; no issuer was guessed.",
      );
    issuers = [
      {
        kind: "google_oidc",
        name: "cloud-scheduler",
        service_account: `atlas-scheduler@${match[1]}.iam.gserviceaccount.com`,
        audience: `${canonical}/api/discovery-runs/scheduled`,
        actions: ["machine.runs.trigger_scheduled"],
      },
      {
        kind: "ed25519_jwt",
        name: "atlas-admin",
        issuer: required(runtime, "ATLAS_ADMIN_PUBLIC_URL"),
        audience: "urn:atlas:platform-api",
        public_key: required(env, "ATLAS_ADMIN_SIGNING_PUBLIC_KEY"),
        actions: [
          "platform.discounts.review",
          "platform.costs.view",
          "platform.switches.read",
          "platform.switches.write",
          "platform.accounts.read",
          "platform.waitlist.read",
          "platform.waitlist.write",
        ],
      },
    ];
  }
  const settings = {
    ENVIRONMENT: "production",
    DATABASE_BACKEND: "postgres",
    ATLAS_MANAGED: "true",
    ATLAS_MULTI_USER: "true",
    ...Object.fromEntries(
      [
        "DATABASE_URL",
        "ATLAS_AUTH_CALLBACK_SECRET",
        "ATLAS_EDGE_ORIGIN_SECRET",
        "ATLAS_PUBLIC_URL",
        "ATLAS_AUTH_JWT_AUDIENCES",
        "ATLAS_AUTH_API_KEY_INTROSPECTION_URL",
        "ATLAS_AUTH_MEMBERSHIP_URL",
        "ATLAS_INSTANCE_OPERATOR_EMAILS",
        "ATLAS_PLATFORM_OPERATOR_EMAILS",
      ].map((key) => [key, required(runtime, key)]),
    ),
    ATLAS_MACHINE_TRUSTED_ISSUERS: JSON.stringify(issuers),
    ATLAS_ACCESS_TEAM_DOMAIN: required(env, "ATLAS_ACCESS_TEAM_DOMAIN"),
    ATLAS_ACCESS_AUD: required(env, "ATLAS_ACCESS_AUD"),
    ANTHROPIC_API_KEY: required(env, "ANTHROPIC_API_KEY"),
    SEARCH_API_KEY: env.SEARCH_API_KEY ?? "",
    DISCOVERY_REGISTRY_MAX_ORGANIZATIONS: "250",
    DISCOVERY_REGISTRY_MAX_PEOPLE: "500",
    ATLAS_ANON_RATE_LIMIT_ENABLED: "true",
    ATLAS_ANON_RATE_LIMIT_READS_PER_MINUTE: "30",
    ATLAS_ANON_RATE_LIMIT_WRITES_PER_MINUTE: "10",
    ATLAS_ANON_RATE_LIMIT_TOTAL_PER_HOUR: "120",
    ATLAS_ANON_CREDENTIAL_RATE_LIMIT_PER_MINUTE: "60",
    ATLAS_ANON_CREDENTIAL_RATE_LIMIT_TOTAL_PER_HOUR: "600",
    ATLAS_TRUSTED_PROXY_HOPS: "1",
    ATLAS_TRUST_UNSIGNED_FORWARD_HEADERS: "false",
    CORS_ORIGINS: JSON.stringify([canonical]),
  };
  return {
    runtime,
    service: {
      spec: {
        template: {
          spec: {
            containers: [
              {
                env: Object.entries(settings).map(([name, value]) => ({
                  name,
                  value,
                })),
              },
            ],
          },
        },
      },
    },
  };
}

/** Only trusted, approved CI may publish the retained account and directory runtime. */
export function publicationContext(env) {
  const target = env.ATLAS_PUBLICATION_TARGET;
  const operation = env.ATLAS_PUBLICATION_OPERATION;
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_REPOSITORY !== "RebuildingAmerica/atlas" ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") ||
    !["staging", "production"].includes(target) ||
    !OPERATIONS.includes(operation)
  )
    throw Error(
      "An explicit trusted Atlas CI publication context is required.",
    );
  const tagged = /^refs\/tags\/v[^\s/]+$/.test(env.GITHUB_REF ?? "");
  if (
    !tagged &&
    !(target === "staging" && env.GITHUB_REF === "refs/heads/main")
  )
    throw Error(
      "Production requires a v* release tag; staging requires main or a release tag.",
    );
  if (
    target !== "production" &&
    [
      "promote-web",
      "finalize-web",
      "restore-routing",
      "promote-api",
      "restore-api",
    ].includes(operation)
  )
    throw Error(
      "Canonical routing operations require the production environment.",
    );
  if (
    operation === "promote-web" &&
    !/^\d+$/.test(env.ATLAS_PUBLICATION_ROLLBACK_RUN_ID ?? "")
  )
    throw Error(
      "Web promotion requires an explicit numeric Cloudflare rollback run ID.",
    );
  if (!/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? ""))
    throw Error("Explicit Cloudflare account is required.");
  if (operation !== "doctor") required(env, "CLOUDFLARE_API_TOKEN");
  required(env, "GH_TOKEN");
  return {
    target,
    operation,
    sha: env.GITHUB_SHA,
    repository: env.GITHUB_REPOSITORY,
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
  };
}

/** Artifact authority is the protected publisher, never an arbitrary workflow or fork. */
export function validateRetainedRun(
  run,
  context,
  { runId, previous = false, recovery = false },
) {
  if (
    !/^\d+$/.test(runId ?? "") ||
    String(run?.id) !== runId ||
    run.head_repository?.full_name !== context.repository ||
    ![
      `.github/workflows/deploy-${context.target}.yml`,
      ...(recovery && context.target === "production"
        ? [".github/workflows/rollback-production.yml"]
        : []),
    ].includes(run.path) ||
    run.status !== "completed" ||
    (!recovery && run.conclusion !== "success") ||
    (!previous &&
      !(recovery && context.operation === "verify-api") &&
      run.head_sha !== context.sha) ||
    !/^[a-f0-9]{40}$/.test(run.head_sha ?? "") ||
    (!(context.target === "staging" && run.head_branch === "main") &&
      !/^v[^\s/]+$/.test(run.head_branch ?? ""))
  )
    throw Error(RETAINED_SOURCE_IDENTITY_ERROR);
  return run;
}

/** Web readers can use a verified directory while discovery alarms stay paused. */
export function assertWebApiRuntime(api, evidence) {
  if (
    !["verified-active", "verified-paused"].includes(api?.status) ||
    ["api", "discovery"].some(
      (role) =>
        !sameRuntimeRelease(
          api.runtimeReleases?.[role],
          evidence.durable?.runtimeReleases?.[role],
        ),
    )
  )
    throw Error(
      "The protected web candidate requires the exact verified API/discovery pair.",
    );
}

function atomicJson(file, value) {
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
    flush: true,
  });
  renameSync(temporary, file);
}

/** Keep profile URLs on the current API without replacing their original routing history. */
export function verifyPublicationApiRouting({
  bundle,
  apiDirectory,
  operationsArtifact,
  accessFile,
  zoneId,
  publicHostname,
  operationsHostname,
  node,
  requireCanonical = false,
  now = Date.now,
}) {
  const manifestFile = join(apiDirectory, "api-release.json");
  const journalFile = join(bundle, "api-public-routing.json");
  const receipt = parseJson(
    node("api-public-routing.mjs", [
      "--mode",
      "verify",
      "--manifest",
      manifestFile,
      "--artifact",
      operationsArtifact,
      "--journal",
      journalFile,
      "--access-file",
      accessFile,
      "--zone-id",
      zoneId,
      "--public-hostname",
      publicHostname,
      "--operations-hostname",
      operationsHostname,
      ...(requireCanonical ? ["--require-canonical"] : []),
    ]),
  );
  const manifest = read(manifestFile);
  if (requireCanonical || receipt.status === "verified-canonical") {
    assertCurrentApiRoutingReceipt({
      manifest,
      receipt,
      journal: existsSync(journalFile) ? read(journalFile) : undefined,
      zoneId,
      publicHostname,
      now: now(),
    });
    atomicJson(join(apiDirectory, "api-routing-verification.json"), receipt);
  } else if (
    receipt.status !== "verified-protected" ||
    receipt.releaseSha !== manifest.releaseSha
  ) {
    throw Error(
      "Current protected or canonical API routing proof is required.",
    );
  }
  return receipt;
}

export function releasePath(root, relative) {
  const path = resolve(root, relative ?? "");
  if (!relative || path === root || !path.startsWith(root + sep))
    throw Error("Retained release paths must stay inside their artifact.");
  let current = root;
  for (const part of path.slice(root.length + 1).split(sep)) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw Error("Retained artifacts cannot contain symbolic links.");
  }
  return path;
}

/** Refuse credentials in uploaded rollback material, including failure journals. */
export function inspectPublicArtifact(directory, secrets) {
  const patterns = secrets
    .filter((value) => typeof value === "string" && value.length > 8)
    .flatMap((value) => [
      Buffer.from(value),
      Buffer.from(JSON.stringify(value).slice(1, -1)),
    ]);
  function inspect(path) {
    const info = lstatSync(path);
    if (info.isSymbolicLink())
      throw Error("Release artifacts cannot contain symbolic links.");
    if (info.isDirectory()) {
      for (const name of readdirSync(path)) inspect(join(path, name));
      return;
    }
    if (!info.isFile()) throw Error("Unsupported release artifact entry.");
    const data = readFileSync(path);
    if (patterns.some((pattern) => data.includes(pattern)))
      throw Error(
        "A deployment credential is embedded in release artifacts; upload refused.",
      );
  }
  inspect(directory);
}

/** Read existing GitHub-held configuration for Cloudflare releases. */
export async function retainedPublicationRuntime(env) {
  const { loadWebRuntime } = await import("./web-candidate.mjs");
  if (env.ATLAS_WEB_RUNTIME_ENV_JSON?.trim())
    return loadWebRuntime(env.ATLAS_WEB_RUNTIME_ENV_JSON);
  const keys = [
    "ATLAS_PUBLIC_URL",
    "ATLAS_MANAGED",
    "ATLAS_MULTI_USER",
    "DATABASE_BACKEND",
    "ATLAS_DEPLOY_MODE",
    "ATLAS_AUTH_BASE_PATH",
    "ATLAS_AUTH_API_KEY_INTROSPECTION_URL",
    "ATLAS_SERVER_API_PROXY_TARGET",
    "ATLAS_DOCS_URL",
    "ATLAS_EMAIL_FROM",
    "ATLAS_EMAIL_PROVIDER",
    "DATABASE_URL",
    "ATLAS_AUTH_INTERNAL_SECRET",
    "ATLAS_AUTH_CALLBACK_SECRET",
    "ATLAS_AUTH_JWT_AUDIENCES",
    "ATLAS_AUTH_MEMBERSHIP_URL",
    "ATLAS_OPERATOR_ALLOWED_EMAILS",
    "ATLAS_EDGE_ORIGIN_SECRET",
    "ATLAS_ADMIN_PUBLIC_URL",
    "ATLAS_EMAIL_RESEND_API_KEY",
    "ATLAS_PDS_PUBLIC_URL",
    "ATLAS_PDS_INVITE_BROKER_URL",
    "ATLAS_PDS_INVITE_BROKER_SECRET",
    "ATLAS_INSTANCE_OPERATOR_EMAILS",
    "ATLAS_PLATFORM_OPERATOR_EMAILS",
    "ATLAS_BILLING_CHECKOUT_ENABLED",
    "ATLAS_BILLING_AUTOMATIC_TAX",
    "ATLAS_PAID_ACCESS_MODE",
    "ATLAS_SAML_ALLOWED_ISSUERS",
    "ATLAS_SAML_SP_PRIVATE_KEY",
    "ATLAS_SAML_SP_PRIVATE_KEY_PASS",
    "ATLAS_OAUTH_CIMD_DOMAIN_ALLOWLIST",
    "STRIPE_API_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_ATLAS_CATALOG",
    "STRIPE_BILLING_PORTAL_CONFIGURATION",
    "ATLAS_BILLING_ALLOWED_OFFERS",
  ];
  return loadWebRuntime(
    JSON.stringify(
      Object.fromEntries(
        keys.filter((key) => env[key]?.trim()).map((key) => [key, env[key]]),
      ),
    ),
  );
}

/** Keep provider-only existing secrets available to the final artifact scan.
 * Only this private path crosses workflow steps; values never enter GITHUB_ENV. */
export function retainPrivatePublicationDirectory(env) {
  const root = resolve(required(env, "RUNNER_TEMP"));
  const directory = mkdtempSync(join(root, "atlas-publication-"));
  if (/[\r\n]/.test(directory))
    throw Error("Invalid private publication directory.");
  appendFileSync(
    required(env, "GITHUB_ENV"),
    `ATLAS_PUBLICATION_PRIVATE_DIRECTORY=${directory}\n`,
  );
  return directory;
}

function privatePublicationDirectory(env) {
  const directory = env.ATLAS_PUBLICATION_PRIVATE_DIRECTORY;
  if (!directory) return null;
  const root = resolve(required(env, "RUNNER_TEMP"));
  const resolved = resolve(directory);
  if (
    !resolved.startsWith(join(root, "atlas-publication-")) ||
    resolve(resolved, "..") !== root
  )
    throw Error("Invalid private publication directory.");
  if (existsSync(resolved)) {
    const info = lstatSync(resolved);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (info.mode & 0o077) !== 0
    )
      throw Error("Owner-only private publication directory required.");
  }
  return resolved;
}

const secretKey = /TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|DATABASE_URL/i;
function secretValues(value) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(secretValues);
  return Object.entries(value).flatMap(([key, entry]) => {
    if (secretKey.test(key) && typeof entry === "string") return [entry];
    if (
      key === "value" &&
      secretKey.test(value.name ?? "") &&
      typeof entry === "string"
    )
      return [entry];
    return secretValues(entry);
  });
}

export function sealPublication(bundle, env) {
  if (!existsSync(bundle)) return { status: "nothing-to-retain" };
  const secrets = secretValues(env);
  for (const key of [
    "ATLAS_WEB_RUNTIME_ENV_JSON",
    "ATLAS_API_SETTINGS_EXPORT_JSON",
  ])
    if (env[key]?.trim()) secrets.push(...secretValues(parseJson(env[key])));
  const directory = privatePublicationDirectory(env);
  if (directory && !existsSync(directory))
    throw Error(
      "Private publication inputs are missing; artifact retention refused.",
    );
  if (directory && existsSync(directory)) {
    for (const file of readdirSync(directory)) {
      const path = join(directory, file),
        info = lstatSync(path);
      if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0)
        throw Error("Owner-only private publication input required.");
      secrets.push(...secretValues(read(path)));
    }
  }
  inspectPublicArtifact(bundle, secrets);
  return { status: "safe-to-retain" };
}

export function cleanupPrivatePublicationDirectory(env) {
  const directory = privatePublicationDirectory(env);
  if (directory) rmSync(directory, { recursive: true, force: true });
}

/** Exercise the retained PDS and the exact protected browser candidate. */
export function verifyHostedJourneys({
  deployment,
  runtime,
  env,
  run,
  node,
  releaseSha,
}) {
  const candidate = new URL(deployment.candidateUrl);
  if (
    candidate.protocol !== "https:" ||
    candidate.username ||
    candidate.password ||
    candidate.pathname !== "/" ||
    candidate.search ||
    candidate.hash
  )
    throw Error("Exact HTTPS candidate origin required for hosted acceptance.");
  const base = {
    ...env,
    ATLAS_HOSTED_PUBLIC_URL: candidate.origin,
    ATLAS_HOSTED_API_URL: required(runtime, "ATLAS_SERVER_API_PROXY_TARGET"),
    ATLAS_HOSTED_EXPECTED_PUBLIC_URL: required(runtime, "ATLAS_PUBLIC_URL"),
    ATLAS_PDS_PUBLIC_URL: required(runtime, "ATLAS_PDS_PUBLIC_URL"),
    ATLAS_HOSTED_PDS_URL: required(runtime, "ATLAS_PDS_PUBLIC_URL"),
    ATLAS_HOSTED_EXPECT_EDGE: "true",
    ATLAS_HOSTED_EXPECT_CATALOG: "true",
  };
  node("pds-release.mjs", ["health"], { env: base });
  node("pds-release.mjs", ["invite-broker-route"], { env: base });
  const hosted = (script, runtimeEnv) => {
    rmSync(hostedReportFile, { force: true });
    return run(
      "pnpm",
      [
        "--filter",
        "@rebuildingamerica/atlas-app",
        "run",
        script,
        "--reporter=github,json",
      ],
      {
        env: { ...runtimeEnv, PLAYWRIGHT_JSON_OUTPUT_NAME: hostedReportFile },
      },
    );
  };
  hosted("test:hosted-smoke", base);
  return {
    releaseSha,
    workerName: deployment.workerName,
    workerVersionId: deployment.workerVersionId,
    collectedAt: new Date().toISOString(),
    status: "pass",
  };
}

/** Preserve billing on every replacement and public activation. Only a first,
 * protected bootstrap with no existing runtime or public edge can defer billing
 * while the replacement directory is measured. No canonical route is created. */
export function preflightPublicationBilling(
  context,
  run,
  { firstBootstrap = false, cloudflare } = {},
) {
  if (
    context.target !== "production" ||
    [
      "doctor",
      "restore-routing",
      "restore-api",
      "verify-api",
      "finalize-web",
      "pause-api",
    ].includes(context.operation)
  )
    return;
  if (context.operation === "publish-api" && firstBootstrap) {
    const listed = cloudflare(["workers", "list"]);
    const workers = Array.isArray(listed) ? listed : listed?.workers;
    if (
      !Array.isArray(workers) ||
      workers.some((worker) => typeof (worker?.name ?? worker?.id) !== "string")
    )
      throw Error(
        "First-bootstrap isolation could not be verified; no publication was attempted.",
      );
    const names = new Set(workers.map((worker) => worker.name ?? worker.id));
    if (
      !["api", "discovery", "api-ops"].some((role) =>
        names.has(`atlas-${role}-${context.target}`),
      )
    )
      return;
  }
  run("pnpm", ["exec", "tsx", "scripts/deploy/publication-billing.ts"]);
}

export async function publicationCli({
  env = process.env,
  command,
  args = process.argv.slice(2),
} = {}) {
  const context = publicationContext(env);
  const tool =
    command ??
    ((binary, args, options = {}) => {
      try {
        return execFileSync(binary, args, {
          cwd: ROOT,
          encoding: "utf8",
          env,
          stdio: ["ignore", "pipe", "pipe"],
          ...options,
        });
      } catch (error) {
        if (args.includes("scripts/deploy/api_schema_release.py")) {
          const diagnostic = schemaFailureDiagnostic(error.stderr);
          if (diagnostic) console.error(JSON.stringify(diagnostic));
        }
        if (
          args.some((arg) =>
            /^test:hosted-(smoke|identity|checkout)$/.test(arg),
          )
        ) {
          let failures = [];
          try {
            if (existsSync(hostedReportFile))
              failures = hostedFailureReport(read(hostedReportFile));
          } catch {
            /* Private malformed report details remain suppressed. */
          }
          console.error(
            JSON.stringify({
              hostedChecks: "failed",
              failures,
              locations: hostedFailureLocations(
                String(error.stdout ?? "") + "\n" + String(error.stderr ?? ""),
              ),
            }),
          );
        }
        throw Error(
          `${binary} publication step failed; private provider output suppressed. Retain the release journals.`,
        );
      }
    });
  const bundle = join(ROOT, ".atlas/cloudflare-release");
  if (args.includes("--cleanup")) {
    cleanupPrivatePublicationDirectory(env);
    return { status: "private-inputs-removed" };
  }
  if (args.includes("--seal")) {
    const result = sealPublication(bundle, env);
    if (env.GITHUB_OUTPUT)
      appendFileSync(
        env.GITHUB_OUTPUT,
        `has-bundle=${result.status === "safe-to-retain"}\n`,
      );
    return result;
  }
  const { loadWebRuntime } = await import("./web-candidate.mjs");
  if (context.operation === "doctor") {
    if (existsSync(bundle))
      throw Error("Doctor requires a fresh runner directory.");
    mkdirSync(bundle, { recursive: true, mode: 0o700 });
    let retainedHostedFailures;
    const diagnosticRunId = env.ATLAS_PUBLICATION_SOURCE_RUN_ID?.trim();
    const checks = [];
    checks.push({
      setting: "CLOUDFLARE_API_TOKEN",
      status: env.CLOUDFLARE_API_TOKEN?.trim() ? "pass" : "block",
      credentialKind: cloudflareCredentialKind(env.CLOUDFLARE_API_TOKEN),
    });
    for (const args of [
      ["accounts", "subscriptions", "get"],
      ["hyperdrive", "get", env.ATLAS_HYPERDRIVE_ID ?? "missing-id"],
      ["zero-trust", "access", "applications", "list"],
    ]) {
      if (!env.CLOUDFLARE_API_TOKEN?.trim()) {
        checks.push({
          command: `cf ${args.join(" ")}`,
          status: "block",
          reason:
            "Existing general deployment token is unavailable; no credential-store lookup was attempted.",
        });
        continue;
      }
      try {
        cloudflareCommand(args, { env });
        checks.push({ command: `cf ${args.join(" ")}`, status: "pass" });
      } catch (error) {
        checks.push({
          command: `cf ${args.join(" ")}`,
          status: "block",
          failure:
            error instanceof CloudflareCommandError ? error.failure : "unknown",
        });
      }
    }
    const requiredSettings = [
      "ATLAS_CF_ACCESS_SERVICE_TOKEN_ID",
      "ATLAS_HOSTED_CF_ACCESS_CLIENT_ID",
      "ATLAS_HOSTED_CF_ACCESS_CLIENT_SECRET",
      "ATLAS_HYPERDRIVE_ID",
      "CLOUDFLARE_ZONE_ID",
      "ATLAS_API_OPERATIONS_HOSTNAME",
    ];
    for (const key of requiredSettings)
      checks.push({
        setting: key,
        status: env[key]?.trim() ? "pass" : "block",
      });
    try {
      const runtime = await retainedPublicationRuntime(env);
      for (const key of [
        "ATLAS_PDS_PUBLIC_URL",
        "ATLAS_PDS_INVITE_BROKER_URL",
        "ATLAS_PDS_INVITE_BROKER_SECRET",
      ])
        required(runtime, key);
      const configured = assemblePublicationSettings({
        ...env,
        ATLAS_WEB_RUNTIME_ENV_JSON: JSON.stringify(runtime),
      });
      const databaseDirectory = mkdtempSync(
        join(required(env, "RUNNER_TEMP"), "atlas-schema-doctor-"),
      );
      try {
        const databaseConfig = join(databaseDirectory, "runtime.json");
        writeFileSync(databaseConfig, JSON.stringify(configured.runtime), {
          mode: 0o600,
        });
        const output = join(bundle, "schema-doctor.json");
        tool(join(ROOT, "api/.venv/bin/python"), [
          "scripts/deploy/api_schema_release.py",
          "--config-file",
          databaseConfig,
          "--release-sha",
          context.sha,
          "--output",
          output,
        ]);
        const schema = read(output);
        checks.push({
          name: "postgres-read-only",
          status: "pass",
          schemaStatus: schema.status,
          databaseActivity: schema.databaseActivity,
        });
      } finally {
        rmSync(databaseDirectory, { recursive: true, force: true });
      }
      checks.push({
        name: "existing-runtime-settings",
        status: "pass",
        keys: Object.keys(runtime).sort(),
      });
    } catch (error) {
      const safe =
        /^(?:[A-Z_]+ is required|Runtime [A-Z_]+ is required|Existing write-only values are required|Existing value conflict for [A-Z_]+|Staging requires)/.test(
          error.message,
        );
      checks.push({
        name: "existing-runtime-settings",
        status: "block",
        reason: safe
          ? error.message
          : "Retained configuration could not be verified; private diagnostics suppressed.",
      });
    }
    const report = {
      schemaVersion: 1,
      target: context.target,
      accountId: context.accountId,
      releaseSha: context.sha,
      operation: "doctor",
      ...(retainedHostedFailures ? { retainedHostedFailures } : {}),
      status: checks.every((check) => check.status === "pass")
        ? "pass"
        : "block",
      checks,
    };
    atomicJson(join(bundle, "publication.json"), {
      ...report,
      runId: env.GITHUB_RUN_ID,
      state: "read-only-doctor",
    });
    atomicJson(join(bundle, "doctor.json"), report);
    if (report.status !== "pass")
      throw Error(
        "Cloudflare publication doctor found release blockers; see the retained redacted doctor.json.",
      );
    return report;
  }
  if (context.operation === "publish-admin")
    return {
      operation: context.operation,
      target: context.target,
      releaseSha: context.sha,
      status: "admin-action-ready",
    };
  const config = retainPrivatePublicationDirectory(env);
  const retainedRuntime = await retainedPublicationRuntime(env);
  for (const key of [
    "ATLAS_PDS_PUBLIC_URL",
    "ATLAS_PDS_INVITE_BROKER_URL",
    "ATLAS_PDS_INVITE_BROKER_SECRET",
  ])
    required(retainedRuntime, key);
  const configured = assemblePublicationSettings({
    ...env,
    ATLAS_WEB_RUNTIME_ENV_JSON: JSON.stringify(retainedRuntime),
  });
  const runtime = loadWebRuntime(JSON.stringify(configured.runtime));
  const access = {
    id: required(env, "ATLAS_CF_ACCESS_SERVICE_TOKEN_ID"),
    client_id: required(env, "ATLAS_HOSTED_CF_ACCESS_CLIENT_ID"),
    client_secret: required(env, "ATLAS_HOSTED_CF_ACCESS_CLIENT_SECRET"),
  };
  const privateFile = (name, value) => {
    const file = join(config, name);
    writeFileSync(file, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    return file;
  };
  const runtimeFile = privateFile("runtime.json", runtime);
  const accessFile = privateFile("access.json", access);
  env = {
    ...env,
    ATLAS_WEB_RUNTIME_FILE: runtimeFile,
    ATLAS_WEB_RUNTIME_ENV_JSON: JSON.stringify(runtime),
  };
  // The default runner uses this explicit environment; neither cf nor gh consults an OS credential store.
  const run = (binary, args, options = {}) =>
    tool(binary, args, { env, ...options });
  const node = (script, args = [], options = {}) =>
    run(
      process.execPath,
      [join(ROOT, "scripts/deploy", script), ...args],
      options,
    );
  const hostedJourneys = (directory, publicOrigin) =>
    verifyHostedJourneys({
      deployment: {
        ...read(join(directory, "deployment.json")),
        ...(publicOrigin ? { candidateUrl: publicOrigin } : {}),
      },
      runtime,
      env,
      run,
      node,
      releaseSha: context.sha,
    });
  const configureCallbacks = async (origin, webDirectory, phase) => {
    const { publishCallbackConfiguration } =
      await import("./api-callback-configuration.mjs");
    const previous = read(
      join(releasePath(bundle, index.apiDirectory), "api-release.json"),
    );
    if (previous.status !== "verified-paused")
      throw Error(
        "Callback configuration requires the verified paused API pair.",
      );
    const artifactDirectory = releasePath(
      bundle,
      index.apiPublicationDirectory ?? index.apiDirectory,
    );
    const directory = join(
      bundle,
      `api/callbacks-${phase}-${env.GITHUB_RUN_ID}`,
    );
    index.pendingApiDirectory = directory.slice(bundle.length + 1);
    atomicJson(join(bundle, "publication.json"), index);
    const manifest = await publishCallbackConfiguration({
      previous,
      artifactDirectory,
      directory,
      service: configured.service,
      runtime,
      origin,
      access,
      env,
      checkpoint: async () => {},
    });
    index.apiDirectory = directory.slice(bundle.length + 1);
    index.apiPublicationDirectory = index.apiDirectory;
    delete index.pendingApiDirectory;
    if (index.publicApiState === "verified")
      index.publicApiState = "verification-required";
    atomicJson(join(bundle, "publication.json"), index);
    // These are actual cf version readbacks; never retain the replaced versions
    // as the candidate's dependencies or mark its journeys passed here.
    for (const name of ["manifest.json", "deployment.json"]) {
      const file = join(webDirectory, name);
      const web = read(file);
      web.runtimeDependencies = manifest.runtimeReleases;
      atomicJson(file, web);
    }
    if (evidenceFile) {
      const evidence = read(evidenceFile);
      evidence.durable.runtimeReleases = {
        ...evidence.durable.runtimeReleases,
        ...manifest.runtimeReleases,
      };
      atomicJson(evidenceFile, evidence);
    }
    return manifest;
  };
  const sourceRun = env.ATLAS_PUBLICATION_SOURCE_RUN_ID?.trim();
  let index;
  const download = (id, destination, flags) => {
    if (!/^\d+$/.test(id ?? ""))
      throw Error("An explicit numeric publication run ID is required.");
    const report = parseJson(
      run("gh", ["api", `repos/${context.repository}/actions/runs/${id}`]),
    );
    validateRetainedRun(report, context, { runId: id, ...flags });
    run("gh", [
      "run",
      "download",
      id,
      "--repo",
      context.repository,
      "--name",
      `cloudflare-release-${context.target}-${id}`,
      "--dir",
      destination,
    ]);
    const saved = read(join(destination, "publication.json"));
    if (
      saved.target !== context.target ||
      saved.releaseSha !== report.head_sha ||
      saved.accountId !== context.accountId
    )
      throw Error(
        "Retained publication metadata differs from its trusted workflow.",
      );
    inspectPublicArtifact(destination, []);
    return saved;
  };
  if (existsSync(bundle))
    throw Error("Publication requires a fresh runner directory.");
  if (sourceRun)
    index = download(sourceRun, bundle, {
      previous:
        context.operation === "publish-api" ||
        context.operation === "finalize-web" ||
        context.operation === "restore-routing" ||
        context.operation === "restore-api",
      recovery: [
        "restore-routing",
        "restore-api",
        "verify-api",
        "finalize-web",
        "pause-api",
      ].includes(context.operation),
    });
  else {
    if (
      context.operation !== "publish-api" ||
      env.ATLAS_API_BOOTSTRAP !== "true"
    )
      throw Error(
        "An explicit retained source run or first-release API bootstrap is required.",
      );
    mkdirSync(bundle, { recursive: true, mode: 0o700 });
    index = {
      schemaVersion: 1,
      target: context.target,
      accountId: context.accountId,
    };
  }
  index = {
    ...index,
    releaseSha: context.sha,
    operation: context.operation,
    runId: env.GITHUB_RUN_ID,
    state: "in-progress",
  };
  atomicJson(join(bundle, "publication.json"), index);
  // A retained predecessor may contain diagnostics from an earlier operation.
  // Keep these files specific to the current attempt so recovery is unambiguous.
  for (const name of [
    "publication-diagnostics.jsonl",
    "billing-diagnostics.jsonl",
  ])
    writeFileSync(join(bundle, name), "", { mode: 0o600 });
  env.ATLAS_PUBLICATION_BILLING_DIAGNOSTICS_FILE = join(
    bundle,
    "billing-diagnostics.jsonl",
  );
  publicationStage(bundle, "billing-preflight", () =>
    preflightPublicationBilling(context, run, {
      firstBootstrap:
        context.operation === "publish-api" &&
        !sourceRun &&
        env.ATLAS_API_BOOTSTRAP === "true",
      cloudflare: (args) => cloudflareCommand(args, { env }),
    }),
  );
  let evidenceFile;
  if (
    [
      "publish-api",
      "activate-api",
      "web-candidate",
      "promote-api",
      "promote-web",
    ].includes(context.operation)
  ) {
    const evidence = publicationStage(bundle, "evidence-validation", () => {
      const evidence = parseJson(required(env, "ATLAS_WEB_EVIDENCE_JSON"));
      if (
        evidence.releaseSha !== context.sha ||
        evidence.cloudflare?.accountId !== context.accountId ||
        !evidence.releasePolicy
      )
        throw Error(
          "Measured evidence must name this exact Cloudflare-only release and account.",
        );
      assertDurableBudget(evidence);
      return evidence;
    });
    evidenceFile = privateFile("evidence.json", evidence);
    env.ATLAS_WEB_EVIDENCE_FILE = evidenceFile;
    // Diagnose existing CI-token permission failures before a schema or Worker write.
    for (const args of [
      ["accounts", "subscriptions", "get"],
      ["hyperdrive", "get", required(env, "ATLAS_HYPERDRIVE_ID")],
      ["zero-trust", "access", "applications", "list"],
    ]) {
      try {
        publicationStage(
          bundle,
          {
            accounts: "cloudflare-subscriptions-read",
            hyperdrive: "cloudflare-hyperdrive-read",
            "zero-trust": "cloudflare-access-read",
          }[args[0]],
          () => {
            const value = cloudflareCommand(args, { env });
            if (
              args[0] === "accounts" &&
              (!Array.isArray(value) ||
                value.some(
                  (subscription) =>
                    /workers/i.test(subscription.rate_plan?.id ?? "") &&
                    !/free/i.test(subscription.rate_plan.id),
                ))
            )
              throw Error("Workers Free readback failed.");
          },
        );
      } catch {
        throw Error(
          `Existing Cloudflare CI credentials cannot read prerequisite: cf ${args.join(" ")}. No schema or Worker write was attempted.`,
        );
      }
    }
  }
  const operations = required(env, "ATLAS_API_OPERATIONS_HOSTNAME");
  const zone = required(env, "CLOUDFLARE_ZONE_ID");
  if (context.operation === "publish-api") {
    const nativeRun = publicationStage(bundle, "native-dependencies", () => {
      const nativeRun = required(env, "ATLAS_PYTHON_WHEELS_RUN_ID");
      if (!/^\d+$/.test(nativeRun))
        throw Error("A numeric native-wheel workflow run is required.");
      run("python3", [
        "scripts/deploy/api-cloudflare-native-dependencies.py",
        "--run",
        nativeRun,
        "--full-api",
      ]);
      return nativeRun;
    });
    const apiSettings = privateFile("api-settings.json", configured.service);
    const directory = join(bundle, `api/publication-${env.GITHUB_RUN_ID}`);
    mkdirSync(directory, { recursive: true });
    index.pendingApiDirectory = directory.slice(bundle.length + 1);
    atomicJson(join(bundle, "publication.json"), index);
    const schema = join(directory, "schema-receipt.json");
    publicationStage(bundle, "api-schema", () =>
      run(join(ROOT, "api/.venv/bin/python"), [
        "scripts/deploy/api_schema_release.py",
        "--config-file",
        runtimeFile,
        "--release-sha",
        context.sha,
        "--output",
        schema,
        "--apply",
      ]),
    );
    const provenance = join(ROOT, ".atlas/python-native-evaluation", nativeRun);
    const prior = index.apiDirectory
      ? releasePath(bundle, index.apiDirectory)
      : undefined;
    node("api-cloudflare-release.mjs", [
      "--target",
      context.target,
      "--directory",
      directory,
      "--runtime-file",
      runtimeFile,
      "--api-settings-file",
      apiSettings,
      "--access-file",
      accessFile,
      "--schema-receipt",
      schema,
      "--vendor",
      join(ROOT, ".atlas/python-api-dependencies"),
      "--native-provenance",
      join(provenance, "api-provenance.json"),
      "--packages-provenance",
      join(provenance, "packages-provenance.json"),
      "--hyperdrive-id",
      required(env, "ATLAS_HYPERDRIVE_ID"),
      "--zone-id",
      zone,
      "--operations-hostname",
      operations,
      ...(prior
        ? ["--previous-release", join(prior, "api-release.json")]
        : ["--bootstrap"]),
      "--apply",
    ]);
    index.apiDirectory = directory.slice(bundle.length + 1);
    index.apiPublicationDirectory = index.apiDirectory;
    delete index.apiHttpState;
    if (index.publicApiState === "verified")
      index.publicApiState = "verification-required";
    delete index.pendingApiDirectory;
  } else if (
    ["verify-api", "activate-api", "pause-api"].includes(context.operation)
  ) {
    const previous = releasePath(
      bundle,
      context.operation === "verify-api"
        ? (index.pendingApiDirectory ?? index.apiDirectory)
        : index.apiDirectory,
    );
    if (context.operation === "verify-api") {
      if (index.pendingConsumerDirectory)
        throw Error(
          "Reconcile the retained consumer journal before paused verification; no deployment was attempted.",
        );
      const manifestFile = join(previous, "api-release.json");
      const manifest = existsSync(manifestFile)
        ? read(manifestFile)
        : read(join(previous, "release-journal.json")).manifest;
      if (
        manifest?.status === "verified-active" ||
        !existsSync(join(previous, "release-journal.json"))
      )
        throw Error(
          "verify-api accepts paused publication artifacts only; active API acceptance belongs to the protected web journey checks.",
        );
      const apiSettings = privateFile("api-settings.json", configured.service);
      publicationStage(bundle, "api-verify", () =>
        node("api-cloudflare-release.mjs", [
          "--target",
          context.target,
          "--directory",
          previous,
          "--runtime-file",
          runtimeFile,
          "--api-settings-file",
          apiSettings,
          "--access-file",
          accessFile,
          "--operations-hostname",
          operations,
          "--zone-id",
          zone,
          "--verify-only",
        ]),
      );
      if (context.target === "production") {
        const receipt = publicationStage(bundle, "api-routing-verify", () =>
          verifyPublicationApiRouting({
            bundle,
            apiDirectory: previous,
            operationsArtifact: join(previous, "operations"),
            accessFile,
            zoneId: zone,
            publicHostname: new URL(runtime.ATLAS_SERVER_API_PROXY_TARGET)
              .hostname,
            operationsHostname: operations,
            node,
            requireCanonical: ["verified", "verification-required"].includes(
              index.publicApiState,
            ),
          }),
        );
        if (receipt.status === "verified-canonical")
          index.publicApiState = "verified";
        index.apiHttpState = "verified-protected";
      }
      index.apiDirectory = previous.slice(bundle.length + 1);
      delete index.pendingApiDirectory;
    } else {
      const mode = context.operation === "activate-api" ? "activate" : "pause";
      if (index.pendingConsumerDirectory) {
        if (mode !== "pause")
          throw Error(
            "Recover the retained consumer journal with pause-api before another activation.",
          );
        const pending = releasePath(bundle, index.pendingConsumerDirectory);
        node("api-cloudflare-consumers.mjs", [
          "--mode",
          "pause",
          "--manifest",
          join(previous, "api-release.json"),
          "--api-artifact",
          join(previous, "api"),
          "--discovery-artifact",
          join(previous, "discovery"),
          "--directory",
          pending,
          "--recover-activation-journal",
          join(pending, "consumer-journal.json"),
          "--access-file",
          accessFile,
          "--operations-hostname",
          operations,
          "--zone-id",
          zone,
          "--apply",
        ]);
        delete index.pendingConsumerDirectory;
      } else {
        const directory = join(bundle, `api/${mode}-${env.GITHUB_RUN_ID}`);
        index.pendingConsumerDirectory = directory.slice(bundle.length + 1);
        atomicJson(join(bundle, "publication.json"), index);
        const ownership =
          mode === "activate"
            ? privateFile(
                "ownership.json",
                parseJson(required(env, "ATLAS_CONSUMER_HANDOFF_JSON")),
              )
            : undefined;
        node("api-cloudflare-consumers.mjs", [
          "--mode",
          mode,
          "--manifest",
          join(previous, "api-release.json"),
          "--api-artifact",
          join(previous, "api"),
          "--discovery-artifact",
          join(previous, "discovery"),
          "--directory",
          directory,
          "--access-file",
          accessFile,
          "--operations-hostname",
          operations,
          "--zone-id",
          zone,
          ...(mode === "activate"
            ? ["--preflight", evidenceFile, "--ownership", ownership]
            : []),
          "--apply",
        ]);
        index.apiDirectory = directory.slice(bundle.length + 1);
        delete index.apiHttpState;
        if (index.publicApiState === "verified")
          index.publicApiState = "verification-required";
        delete index.pendingConsumerDirectory;
      }
    }
  } else if (["promote-api", "restore-api"].includes(context.operation)) {
    const apiDirectory = releasePath(bundle, index.apiDirectory);
    const artifactDirectory = releasePath(
      bundle,
      index.apiPublicationDirectory ?? index.apiDirectory,
    );
    node("api-public-routing.mjs", [
      "--mode",
      context.operation === "promote-api" ? "promote" : "restore",
      "--manifest",
      join(apiDirectory, "api-release.json"),
      "--artifact",
      join(artifactDirectory, "operations"),
      "--journal",
      join(bundle, "api-public-routing.json"),
      "--access-file",
      accessFile,
      "--zone-id",
      zone,
      "--public-hostname",
      new URL(runtime.ATLAS_SERVER_API_PROXY_TARGET).hostname,
      "--operations-hostname",
      operations,
      "--apply",
    ]);
    index.publicApiState =
      context.operation === "promote-api" ? "verified" : "restored";
  } else if (context.operation === "web-candidate") {
    publicationStage(bundle, "web-runtime-identity", () => {
      const api = read(
        join(releasePath(bundle, index.apiDirectory), "api-release.json"),
      );
      const evidence = read(evidenceFile);
      assertWebApiRuntime(api, evidence);
    });
    const candidateRuntimeFile = join(config, "candidate-runtime.json");
    publicationStage(bundle, "web-runtime-prepare", () =>
      node("web-candidate.mjs", [
        "prepare-runtime",
        "--target",
        "staging",
        "--architecture",
        "workers",
        "--output",
        candidateRuntimeFile,
      ]),
    );
    env.ATLAS_WEB_RUNTIME_FILE = candidateRuntimeFile;
    publicationStage(bundle, "web-build", () =>
      node("web-runtime-command.mjs", [
        "--",
        "pnpm",
        "web:prepare",
        "--target",
        "staging",
        "--architecture",
        "workers",
      ]),
    );
    publicationStage(bundle, "web-auth-migration", () =>
      node("web-runtime-command.mjs", ["--", "pnpm", "web:migrate-auth"]),
    );
    const destination = join(bundle, `web/candidate-${env.GITHUB_RUN_ID}`);
    publicationStage(bundle, "web-artifact-copy", () => {
      const built = join(
        ROOT,
        ".atlas/web/staging",
        context.sha,
        "cloudflare-durable",
      );
      mkdirSync(join(bundle, "web"), { recursive: true });
      cpSync(built, destination, { recursive: true });
    });
    publicationStage(bundle, "web-publish", () =>
      node("web-candidate.mjs", [
        "publish",
        "--target",
        "staging",
        "--architecture",
        "workers",
        "--directory",
        destination,
      ]),
    );
    await publicationStage(bundle, "web-callback-configuration", () =>
      configureCallbacks(
        read(join(destination, "deployment.json")).candidateUrl,
        destination,
        "candidate",
      ),
    );
    publicationStage(bundle, "web-archive", () =>
      node("web-archive.mjs", ["--directory", destination]),
    );
    publicationStage(bundle, "web-observe", () =>
      node("web-observe.mjs", [
        "--target",
        "staging",
        "--deployment",
        join(destination, "deployment.json"),
        "--journal",
        join(destination, "observations.jsonl"),
      ]),
    );
    index.webDirectory = destination.slice(bundle.length + 1);
    atomicJson(join(bundle, "publication.json"), index);
    index.hostedAcceptance = publicationStage(
      bundle,
      "web-hosted-journeys",
      () => hostedJourneys(destination),
    );
  } else if (context.operation === "finalize-web") {
    const source = releasePath(
      bundle,
      index.webDirectory ?? `web/candidate-${sourceRun}`,
    );
    const artifact = read(join(source, "deployment.json"));
    const canonical =
      runtime.ATLAS_WEB_CANONICAL_URL ?? runtime.ATLAS_PUBLIC_URL;
    // The controller may advance independently; callback publication reuses
    // the retained API/discovery bundles and their original source SHA.
    index.artifactReleaseSha = artifact.releaseSha;
    index.controllerReleaseSha = context.sha;
    index.webDirectory = source.slice(bundle.length + 1);
    atomicJson(join(bundle, "publication.json"), index);
    const api = await publicationStage(
      bundle,
      "web-callback-configuration",
      () => configureCallbacks(canonical, source, "canonical"),
    );
    index.canonicalCallbacksOrigin = canonical;
    index.artifactSourceRunId = sourceRun;
    index.runtimeDependencies = api.runtimeReleases;
  } else if (context.operation === "promote-web") {
    const source = releasePath(bundle, index.webDirectory);
    index.hostedAcceptance = hostedJourneys(source);
    node("web-observe.mjs", [
      "--target",
      "staging",
      "--deployment",
      join(source, "deployment.json"),
      "--journal",
      join(source, "observations.jsonl"),
    ]);
    const destination = join(bundle, `web/production-${env.GITHUB_RUN_ID}`);
    index.pendingProductionDirectory = destination.slice(bundle.length + 1);
    atomicJson(join(bundle, "publication.json"), index);
    // Retained Cloudflare routing keeps profiles and sessions recoverable after
    // the legacy hosting projects have been retired.
    const rollbackRoot = join(ROOT, ".atlas/cloudflare-rollback");
    const rollback = download(
      env.ATLAS_PUBLICATION_ROLLBACK_RUN_ID,
      rollbackRoot,
      { previous: true },
    );
    const recoveryArgs = [
      "--rollback-cloudflare-source",
      releasePath(rollbackRoot, rollback.productionDirectory),
    ];
    if (env.ATLAS_API_ROLLBACK_PLAN_JSON)
      recoveryArgs.push(
        "--api-rollback-plan",
        privateFile(
          "api-rollback-plan.json",
          parseJson(env.ATLAS_API_ROLLBACK_PLAN_JSON),
        ),
      );
    publicationStage(bundle, "api-routing-verify", () =>
      verifyPublicationApiRouting({
        bundle,
        apiDirectory: releasePath(bundle, index.apiDirectory),
        operationsArtifact: join(
          releasePath(
            bundle,
            index.apiPublicationDirectory ?? index.apiDirectory,
          ),
          "operations",
        ),
        accessFile,
        zoneId: zone,
        publicHostname: new URL(runtime.ATLAS_SERVER_API_PROXY_TARGET).hostname,
        operationsHostname: operations,
        node,
        requireCanonical: true,
      }),
    );
    index.publicApiState = "verified";
    node("web-promote.mjs", [
      "--target",
      "production",
      "--source",
      source,
      "--journal",
      join(source, "observations.jsonl"),
      "--evidence",
      evidenceFile,
      "--directory",
      destination,
      "--hostname",
      new URL(runtime.ATLAS_PUBLIC_URL).hostname,
      ...recoveryArgs,
      "--apply",
    ]);
    await publicationStage(bundle, "web-callback-configuration", () =>
      configureCallbacks(
        runtime.ATLAS_WEB_CANONICAL_URL ?? runtime.ATLAS_PUBLIC_URL,
        destination,
        "canonical",
      ),
    );
    node("web-archive.mjs", ["--directory", destination]);
    index.hostedAcceptance = hostedJourneys(
      destination,
      runtime.ATLAS_WEB_CANONICAL_URL ?? runtime.ATLAS_PUBLIC_URL,
    );
    index.productionDirectory = destination.slice(bundle.length + 1);
    delete index.pendingProductionDirectory;
  } else {
    const directory = releasePath(
      bundle,
      index.pendingProductionDirectory ?? index.productionDirectory,
    );
    const recoveryArgs = env.ATLAS_API_ROLLBACK_PLAN_JSON
      ? [
          "--api-rollback-plan",
          privateFile(
            "api-rollback-plan.json",
            parseJson(env.ATLAS_API_ROLLBACK_PLAN_JSON),
          ),
        ]
      : [];
    node("web-promote.mjs", [
      "--restore-cloudflare-routing",
      "--target",
      "production",
      "--directory",
      directory,
      "--hostname",
      new URL(runtime.ATLAS_PUBLIC_URL).hostname,
      ...recoveryArgs,
      "--apply",
    ]);
  }
  index.state = "verified-operation";
  atomicJson(join(bundle, "publication.json"), index);
  return {
    operation: context.operation,
    target: context.target,
    releaseSha: context.sha,
    status: "verified-operation",
  };
  // The always-run seal and cleanup steps own the private captured inputs.
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const auxiliary =
    process.argv.includes("--seal") || process.argv.includes("--cleanup");
  const reportOutcome = (report, failed = false, error) => {
    const summary = publicationSummary({
      env: process.env,
      report,
      failed,
      error,
    });
    console[failed ? "error" : "log"](summary);
    if (process.env.GITHUB_STEP_SUMMARY) {
      try {
        appendFileSync(
          process.env.GITHUB_STEP_SUMMARY,
          `${summary.replaceAll("\n", "\n\n")}\n\n`,
        );
      } catch {
        console.error(
          "Could not write the Actions summary; the outcome is in this step's log.",
        );
      }
    }
  };
  publicationCli()
    .then((report) =>
      auxiliary ? console.log(JSON.stringify(report)) : reportOutcome(report),
    )
    .catch((error) => {
      if (auxiliary)
        console.error(
          "Release artifact sealing or cleanup failed; private output suppressed.",
        );
      else reportOutcome(undefined, true, error);
      process.exitCode = 1;
    });
}
