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
import { cloudflareCommand } from "./cloudflare-cli.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const OPERATIONS = [
  "doctor",
  "publish-api",
  "verify-api",
  "activate-api",
  "pause-api",
  "promote-api",
  "restore-api",
  "web-candidate",
  "promote-web",
  "restore-routing",
];
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
        ATLAS_HOSTED_E2E_ENABLED: "1",
        ATLAS_HOSTED_E2E_PRODUCTION_ENABLED: "1",
        ...Object.fromEntries(
          [
            "DATABASE_URL",
            "ATLAS_AUTH_INTERNAL_SECRET",
            "ATLAS_AUTH_CALLBACK_SECRET",
            "ATLAS_EDGE_ORIGIN_SECRET",
            "ATLAS_ADMIN_PUBLIC_URL",
            "ATLAS_EMAIL_RESEND_API_KEY",
            "ATLAS_HOSTED_E2E_SECRET",
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
    ["promote-web", "restore-routing", "promote-api", "restore-api"].includes(
      operation,
    )
  )
    throw Error(
      "Canonical routing operations require the production environment.",
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
    (!previous && run.head_sha !== context.sha) ||
    !/^[a-f0-9]{40}$/.test(run.head_sha ?? "") ||
    (!(context.target === "staging" && run.head_branch === "main") &&
      !/^v[^\s/]+$/.test(run.head_branch ?? ""))
  )
    throw Error(
      "Retained artifacts require a completed trusted publication run with the expected source identity.",
    );
  return run;
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

/** Recover the complete existing runtime inside Linux CI, retaining optional SSO/PDS settings. */
export async function retainedPublicationRuntime(env, { collect } = {}) {
  const { loadWebRuntime } = await import("./web-candidate.mjs");
  if (env.ATLAS_WEB_RUNTIME_ENV_JSON?.trim())
    return loadWebRuntime(env.ATLAS_WEB_RUNTIME_ENV_JSON);
  const { collectWebRuntime } = await import("./web-runtime-sync.mjs");
  const keys = [
    "ATLAS_PUBLIC_URL",
    "DATABASE_URL",
    "ATLAS_AUTH_INTERNAL_SECRET",
    "ATLAS_AUTH_CALLBACK_SECRET",
    "ATLAS_AUTH_JWT_AUDIENCES",
    "ATLAS_AUTH_MEMBERSHIP_URL",
    "ATLAS_OPERATOR_ALLOWED_EMAILS",
    "ATLAS_EDGE_ORIGIN_SECRET",
    "ATLAS_ADMIN_PUBLIC_URL",
    "ATLAS_EMAIL_RESEND_API_KEY",
    "ATLAS_HOSTED_E2E_SECRET",
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
  return (collect ?? collectWebRuntime)({
    target: env.ATLAS_PUBLICATION_TARGET,
    project: required(env, "VERCEL_PROJECT_ID"),
    team: required(env, "VERCEL_ORG_ID"),
    token: required(env, "VERCEL_TOKEN"),
    customEnvironmentId: env.ATLAS_VERCEL_STAGING_ENVIRONMENT_ID,
    additional: Object.fromEntries(
      keys.filter((key) => env[key]?.trim()).map((key) => [key, env[key]]),
    ),
  });
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
    ATLAS_HOSTED_E2E_RUN_ID: `${required(env, "GITHUB_RUN_ID")}-${required(env, "GITHUB_RUN_ATTEMPT")}`,
    ATLAS_HOSTED_E2E_SECRET: required(runtime, "ATLAS_HOSTED_E2E_SECRET"),
    ATLAS_PDS_PUBLIC_URL: required(runtime, "ATLAS_PDS_PUBLIC_URL"),
    ATLAS_HOSTED_PDS_URL: required(runtime, "ATLAS_PDS_PUBLIC_URL"),
    ATLAS_HOSTED_EXPECT_EDGE: "true",
    ATLAS_HOSTED_EXPECT_CATALOG: "true",
  };
  node("pds-release.mjs", ["health"], { env: base });
  node("pds-release.mjs", ["invite-broker-route"], { env: base });
  run(
    "pnpm",
    ["--filter", "@rebuildingamerica/atlas-app", "run", "test:hosted-smoke"],
    { env: base },
  );
  // Identity redirects stay on this protected candidate; public MCP metadata
  // above must still advertise the canonical audience customers already use.
  const identity = {
    ...base,
    ATLAS_HOSTED_EXPECTED_PUBLIC_URL: candidate.origin,
  };
  run(
    "pnpm",
    ["--filter", "@rebuildingamerica/atlas-app", "run", "test:hosted-identity"],
    { env: identity },
  );
  if (runtime.ATLAS_BILLING_CHECKOUT_ENABLED === "true")
    run(
      "pnpm",
      [
        "--filter",
        "@rebuildingamerica/atlas-app",
        "run",
        "test:hosted-checkout",
      ],
      { env: identity },
    );
  return {
    releaseSha,
    workerName: deployment.workerName,
    workerVersionId: deployment.workerVersionId,
    collectedAt: new Date().toISOString(),
    status: "pass",
  };
}

export async function publicationCli({
  env = process.env,
  command,
  args = process.argv.slice(2),
} = {}) {
  const context = publicationContext(env);
  const { loadWebRuntime } = await import("./web-candidate.mjs");
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
      } catch {
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
  if (args.includes("--seal")) return sealPublication(bundle, env);
  if (context.operation === "doctor") {
    if (existsSync(bundle))
      throw Error("Doctor requires a fresh runner directory.");
    mkdirSync(bundle, { recursive: true, mode: 0o700 });
    const checks = [];
    checks.push({
      setting: "CLOUDFLARE_API_TOKEN",
      status: env.CLOUDFLARE_API_TOKEN?.trim() ? "pass" : "block",
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
      } catch {
        checks.push({ command: `cf ${args.join(" ")}`, status: "block" });
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
      assemblePublicationSettings({
        ...env,
        ATLAS_WEB_RUNTIME_ENV_JSON: JSON.stringify(runtime),
      });
      checks.push({
        name: "existing-runtime-settings",
        status: "pass",
        keys: Object.keys(runtime).sort(),
      });
    } catch (error) {
      const safe =
        /^(?:[A-Z_]+ is required|Runtime [A-Z_]+ is required|Existing write-only values are required|Existing value conflict for [A-Z_]+|Vercel runtime read failed with HTTP|Staging requires)/.test(
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
    console.log(JSON.stringify(report));
    if (report.status !== "pass")
      throw Error(
        "Cloudflare publication doctor found release blockers; see the retained redacted doctor.json.",
      );
    return report;
  }
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
  const hostedJourneys = (directory) =>
    verifyHostedJourneys({
      deployment: read(join(directory, "deployment.json")),
      runtime,
      env,
      run,
      node,
      releaseSha: context.sha,
    });
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
        context.operation === "restore-routing" ||
        context.operation === "restore-api",
      recovery: [
        "restore-routing",
        "restore-api",
        "verify-api",
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
  // Existing purchases must keep their catalog, portal and webhook before any
  // schema, Worker or consumer change. This command only reads Stripe.
  if (
    context.target === "production" &&
    !["restore-routing", "restore-api", "verify-api", "pause-api"].includes(
      context.operation,
    )
  )
    run("pnpm", ["exec", "tsx", "scripts/deploy/publication-billing.ts"]);
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
    evidenceFile = privateFile("evidence.json", evidence);
    env.ATLAS_WEB_EVIDENCE_FILE = evidenceFile;
    // Diagnose existing CI-token permission failures before a schema or Worker write.
    for (const args of [
      ["accounts", "subscriptions", "get"],
      ["hyperdrive", "get", required(env, "ATLAS_HYPERDRIVE_ID")],
      ["zero-trust", "access", "applications", "list"],
    ]) {
      try {
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
    const nativeRun = required(env, "ATLAS_PYTHON_WHEELS_RUN_ID");
    if (!/^\d+$/.test(nativeRun))
      throw Error("A numeric native-wheel workflow run is required.");
    run("python3", [
      "scripts/deploy/api-cloudflare-native-dependencies.py",
      "--run",
      nativeRun,
      "--full-api",
    ]);
    const apiSettings = privateFile("api-settings.json", configured.service);
    const directory = join(bundle, `api/publication-${env.GITHUB_RUN_ID}`);
    mkdirSync(directory, { recursive: true });
    index.pendingApiDirectory = directory.slice(bundle.length + 1);
    atomicJson(join(bundle, "publication.json"), index);
    const schema = join(directory, "schema-receipt.json");
    run(join(ROOT, "api/.venv/bin/python"), [
      "scripts/deploy/api_schema_release.py",
      "--config-file",
      runtimeFile,
      "--release-sha",
      context.sha,
      "--output",
      schema,
      "--apply",
    ]);
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
      ]);
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
    const api = read(
      join(releasePath(bundle, index.apiDirectory), "api-release.json"),
    );
    const evidence = read(evidenceFile);
    if (
      api.status !== "verified-active" ||
      ["api", "discovery"].some(
        (role) =>
          !sameRuntimeRelease(
            api.runtimeReleases[role],
            evidence.durable?.runtimeReleases?.[role],
          ),
      )
    )
      throw Error(
        "The protected web candidate requires the exact privately activated API/discovery pair.",
      );
    const candidateRuntimeFile = join(config, "candidate-runtime.json");
    node("web-candidate.mjs", [
      "prepare-runtime",
      "--target",
      "staging",
      "--architecture",
      "workers",
      "--output",
      candidateRuntimeFile,
    ]);
    env.ATLAS_WEB_RUNTIME_FILE = candidateRuntimeFile;
    node("web-runtime-command.mjs", [
      "--",
      "pnpm",
      "web:prepare",
      "--target",
      "staging",
      "--architecture",
      "workers",
    ]);
    node("web-runtime-command.mjs", ["--", "pnpm", "web:migrate-auth"]);
    const built = join(
      ROOT,
      ".atlas/web/staging",
      context.sha,
      "cloudflare-durable",
    );
    const destination = join(bundle, `web/candidate-${env.GITHUB_RUN_ID}`);
    mkdirSync(join(bundle, "web"), { recursive: true });
    cpSync(built, destination, { recursive: true });
    node("web-candidate.mjs", [
      "publish",
      "--target",
      "staging",
      "--architecture",
      "workers",
      "--directory",
      destination,
    ]);
    node("web-archive.mjs", ["--directory", destination]);
    node("web-observe.mjs", [
      "--target",
      "staging",
      "--deployment",
      join(destination, "deployment.json"),
      "--journal",
      join(destination, "observations.jsonl"),
    ]);
    index.webDirectory = destination.slice(bundle.length + 1);
    index.hostedAcceptance = hostedJourneys(destination);
  } else if (context.operation === "promote-web") {
    if (index.publicApiState !== "verified")
      throw Error(
        "Canonical API cutover and hosted proof are required before web promotion.",
      );
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
    let recoveryArgs;
    if (env.ATLAS_PUBLICATION_ROLLBACK_RUN_ID) {
      const rollbackRoot = join(ROOT, ".atlas/cloudflare-rollback");
      const rollback = download(
        env.ATLAS_PUBLICATION_ROLLBACK_RUN_ID,
        rollbackRoot,
        { previous: true },
      );
      recoveryArgs = [
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
    } else {
      required(env, "VERCEL_TOKEN");
      recoveryArgs = [
        "--owner",
        required(env, "VERCEL_OWNER"),
        "--project",
        required(env, "VERCEL_PROJECT_ID"),
        "--team",
        required(env, "VERCEL_ORG_ID"),
      ];
    }
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  publicationCli()
    .then((report) => console.log(JSON.stringify(report)))
    .catch((error) => {
      console.error(
        "Cloudflare publication failed; inspect retained redacted diagnostics and interruption journals.",
      );
      process.exitCode = 1;
    });
