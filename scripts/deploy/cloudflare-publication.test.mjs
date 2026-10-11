import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  publicationContext,
  validateRetainedRun,
  releasePath,
  inspectPublicArtifact,
  assemblePublicationSettings,
  retainPrivatePublicationDirectory,
  sealPublication,
  cleanupPrivatePublicationDirectory,
  retainedPublicationRuntime,
  verifyHostedJourneys,
} from "./cloudflare-publication.mjs";

const sha = "a".repeat(40);
const environment = {
  GITHUB_ACTIONS: "true",
  GITHUB_REPOSITORY: "RebuildingAmerica/atlas",
  GITHUB_SHA: sha,
  GITHUB_REF: "refs/tags/v2026.10.11-1",
  ATLAS_PUBLICATION_TARGET: "production",
  ATLAS_PUBLICATION_OPERATION: "publish-api",
  CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
  CLOUDFLARE_API_TOKEN: "existing-ci-token",
  GH_TOKEN: "existing-workflow-token",
};

test("individual CI settings preserve accounts, PDS, billing and separate API credentials", () => {
  const env = Object.fromEntries(
    [
      "DATABASE_URL",
      "ATLAS_AUTH_INTERNAL_SECRET",
      "ATLAS_AUTH_CALLBACK_SECRET",
      "ATLAS_EDGE_ORIGIN_SECRET",
      "ATLAS_EMAIL_RESEND_API_KEY",
      "ATLAS_HOSTED_E2E_SECRET",
      "ATLAS_PDS_INVITE_BROKER_SECRET",
      "ATLAS_INSTANCE_OPERATOR_EMAILS",
      "ATLAS_PLATFORM_OPERATOR_EMAILS",
      "ATLAS_ADMIN_SIGNING_PUBLIC_KEY",
      "ATLAS_ACCESS_TEAM_DOMAIN",
      "ATLAS_ACCESS_AUD",
      "ANTHROPIC_API_KEY",
      "GCP_SERVICE_ACCOUNT",
    ].map((key) => [key, `fixture-${key.toLowerCase()}`]),
  );
  Object.assign(env, {
    ATLAS_PUBLIC_URL: "https://atlas.example.org",
    ATLAS_API_URL: "https://api.example.org",
    ATLAS_ADMIN_PUBLIC_URL: "https://admin.example.org",
    ATLAS_PDS_PUBLIC_URL: "https://pds.example.org",
    ATLAS_PDS_INVITE_BROKER_URL: "https://pds.example.org/_atlas/pds/invites",
    ATLAS_BILLING_CHECKOUT_ENABLED: "false",
    ATLAS_BILLING_AUTOMATIC_TAX: "true",
    ATLAS_PAID_ACCESS_MODE: "waitlist",
    GCP_SERVICE_ACCOUNT: "atlas-deploy@fixture-project.iam.gserviceaccount.com",
    ATLAS_SAML_SP_PRIVATE_KEY: "fixture-existing-enterprise-key",
  });
  const { runtime, service } = assemblePublicationSettings(env);
  assert.equal(
    runtime.ATLAS_PDS_INVITE_BROKER_SECRET,
    env.ATLAS_PDS_INVITE_BROKER_SECRET,
  );
  assert.equal(
    runtime.ATLAS_SAML_SP_PRIVATE_KEY,
    env.ATLAS_SAML_SP_PRIVATE_KEY,
  );
  assert.equal(
    runtime.ATLAS_AUTH_JWT_AUDIENCES,
    "https://atlas.example.org/mcp,https://api.example.org",
  );
  const api = Object.fromEntries(
    service.spec.template.spec.containers[0].env.map(({ name, value }) => [
      name,
      value,
    ]),
  );
  assert.equal(
    api.ATLAS_AUTH_CALLBACK_SECRET,
    runtime.ATLAS_AUTH_CALLBACK_SECRET,
  );
  assert.equal(api.DATABASE_URL, runtime.DATABASE_URL);
  assert.equal(Object.hasOwn(api, "ATLAS_AUTH_INTERNAL_SECRET"), false);
  assert.equal(
    JSON.parse(api.ATLAS_MACHINE_TRUSTED_ISSUERS)[0].service_account,
    "atlas-scheduler@fixture-project.iam.gserviceaccount.com",
  );
  assert.throws(
    () =>
      assemblePublicationSettings({
        ...env,
        ATLAS_PDS_INVITE_BROKER_SECRET: "",
      }),
    /ATLAS_PDS_INVITE_BROKER_SECRET/,
  );
});

test("production publication requires a release tag and explicit existing CI credentials", () => {
  assert.equal(publicationContext(environment).target, "production");
  for (const patch of [
    { GITHUB_REF: "refs/heads/chore/cloudflare-production-recovery" },
    { CLOUDFLARE_API_TOKEN: "" },
    { GH_TOKEN: "" },
    { GITHUB_ACTIONS: "false" },
  ])
    assert.throws(() => publicationContext({ ...environment, ...patch }));
});

test("artifact paths cannot escape their retained root or follow a symbolic link", () => {
  const root = mkdtempSync(join(tmpdir(), "atlas-publication-path-"));
  try {
    assert.equal(releasePath(root, "api/release"), join(root, "api/release"));
    assert.throws(() => releasePath(root, "../outside"));
    assert.throws(() => releasePath(root, root));
    symlinkSync(tmpdir(), join(root, "linked"));
    assert.throws(() => releasePath(root, "linked/file"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("retention rejects raw or JSON-escaped credentials and symbolic links", () => {
  const root = mkdtempSync(join(tmpdir(), "atlas-publication-secrets-"));
  const credential = 'fixture-only-credential-"with-quotes';
  try {
    writeFileSync(
      join(root, "journal.json"),
      JSON.stringify({ value: credential }),
    );
    assert.throws(
      () => inspectPublicArtifact(root, [credential]),
      /credential/,
    );
    writeFileSync(
      join(root, "journal.json"),
      JSON.stringify({ status: "verified-paused" }),
    );
    assert.doesNotThrow(() => inspectPublicArtifact(root, [credential]));
    symlinkSync(tmpdir(), join(root, "linked"));
    assert.throws(() => inspectPublicArtifact(root, []), /symbolic/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runtime captured from the retained host remains private through sealing and is then removed", (t) => {
  const root = mkdtempSync(join(tmpdir(), "atlas-publication-retention-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const githubEnv = join(root, "github-env");
  writeFileSync(githubEnv, "");
  const env = { RUNNER_TEMP: root, GITHUB_ENV: githubEnv };
  const directory = retainPrivatePublicationDirectory(env);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(
    readFileSync(githubEnv, "utf8"),
    `ATLAS_PUBLICATION_PRIVATE_DIRECTORY=${directory}\n`,
  );
  const credential = "fixture-provider-only-enterprise-value";
  writeFileSync(
    join(directory, "runtime.json"),
    JSON.stringify({ ATLAS_SAML_SP_PRIVATE_KEY: credential }),
    { mode: 0o600 },
  );
  const bundle = join(root, "bundle");
  mkdirSync(bundle);
  writeFileSync(
    join(directory, "access.json"),
    JSON.stringify({ client_secret: "fixture-access-only-value" }),
    { mode: 0o600 },
  );
  // The next workflow process has only the path, not values copied into its environment.
  const next = { ...env, ATLAS_PUBLICATION_PRIVATE_DIRECTORY: directory };
  assert.equal(readFileSync(githubEnv, "utf8").includes(credential), false);
  writeFileSync(
    join(bundle, "receipt.json"),
    JSON.stringify({ accidental: credential }),
  );
  assert.throws(() => sealPublication(bundle, next), /credential/);
  writeFileSync(
    join(bundle, "receipt.json"),
    JSON.stringify({ accidental: "fixture-access-only-value" }),
  );
  assert.throws(() => sealPublication(bundle, next), /credential/);
  writeFileSync(
    join(bundle, "receipt.json"),
    JSON.stringify({ status: "verified" }),
  );
  assert.equal(sealPublication(bundle, next).status, "safe-to-retain");
  assert.equal(existsSync(directory), true);
  cleanupPrivatePublicationDirectory(next);
  assert.equal(existsSync(directory), false);
  assert.throws(
    () =>
      cleanupPrivatePublicationDirectory({
        ...next,
        ATLAS_PUBLICATION_PRIVATE_DIRECTORY: root,
      }),
    /private/,
  );
});

test("retained runtime acquisition forwards existing CI additions and preserves provider-only identity values", async () => {
  const supplied = {
    ATLAS_PUBLICATION_TARGET: "production",
    VERCEL_PROJECT_ID: "project",
    VERCEL_ORG_ID: "team",
    VERCEL_TOKEN: "fixture-provider-token",
    ATLAS_AUTH_CALLBACK_SECRET: "fixture-callback",
    ATLAS_PLATFORM_OPERATOR_EMAILS: "operator@example.org",
  };
  let input;
  const result = await retainedPublicationRuntime(supplied, {
    collect: async (value) => {
      input = value;
      return { ATLAS_SAML_SP_PRIVATE_KEY: "fixture-existing-enterprise-value" };
    },
  });
  assert.equal(input.token, supplied.VERCEL_TOKEN);
  assert.deepEqual(input.additional, {
    ATLAS_AUTH_CALLBACK_SECRET: supplied.ATLAS_AUTH_CALLBACK_SECRET,
    ATLAS_PLATFORM_OPERATOR_EMAILS: supplied.ATLAS_PLATFORM_OPERATOR_EMAILS,
  });
  assert.equal(
    result.ATLAS_SAML_SP_PRIVATE_KEY,
    "fixture-existing-enterprise-value",
  );
});

test("hosted journeys verify PDS before smoke, identity and checkout against the exact candidate", () => {
  const calls = [],
    deployment = {
      candidateUrl: "https://candidate.atlas.example.org",
      workerName: "atlas-web",
      workerVersionId: "existing-version",
    };
  const runtime = {
    ATLAS_PUBLIC_URL: "https://atlas.example.org",
    ATLAS_SERVER_API_PROXY_TARGET: "https://api.example.org",
    ATLAS_PDS_PUBLIC_URL: "https://pds.example.org",
    ATLAS_HOSTED_E2E_SECRET: "fixture-hosted-secret",
    ATLAS_BILLING_CHECKOUT_ENABLED: "true",
  };
  const options = {
    deployment,
    runtime,
    env: { GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1" },
    releaseSha: sha,
    run: (command, args, { env }) => calls.push({ command: args.at(-1), env }),
    node: (command, args, { env }) => calls.push({ command: args.at(-1), env }),
  };
  assert.equal(verifyHostedJourneys(options).status, "pass");
  assert.deepEqual(
    calls.map((c) => c.command),
    [
      "health",
      "invite-broker-route",
      "test:hosted-smoke",
      "test:hosted-identity",
      "test:hosted-checkout",
    ],
  );
  assert.equal(
    calls[2].env.ATLAS_HOSTED_EXPECTED_PUBLIC_URL,
    runtime.ATLAS_PUBLIC_URL,
  );
  assert.equal(
    calls[3].env.ATLAS_HOSTED_EXPECTED_PUBLIC_URL,
    deployment.candidateUrl,
  );
  assert.ok(
    calls.every(
      (c) =>
        c.env.ATLAS_HOSTED_API_URL === runtime.ATLAS_SERVER_API_PROXY_TARGET,
    ),
  );
  assert.ok(
    calls.every(
      (c) => c.env.ATLAS_HOSTED_E2E_SECRET === runtime.ATLAS_HOSTED_E2E_SECRET,
    ),
  );
  assert.throws(
    () =>
      verifyHostedJourneys({
        ...options,
        node: () => {
          throw Error("PDS unavailable");
        },
      }),
    /PDS unavailable/,
  );
  assert.equal(calls.length, 5);
});

test("staging uses trusted main or release tags and has no public promotion operation", () => {
  assert.equal(
    publicationContext({
      ...environment,
      ATLAS_PUBLICATION_TARGET: "staging",
      GITHUB_REF: "refs/heads/main",
    }).target,
    "staging",
  );
  assert.throws(() =>
    publicationContext({
      ...environment,
      ATLAS_PUBLICATION_TARGET: "staging",
      ATLAS_PUBLICATION_OPERATION: "promote-web",
    }),
  );
});

test("retained artifacts come only from this repository's trusted publication workflow", () => {
  const context = publicationContext(environment);
  const run = {
    id: 123,
    path: ".github/workflows/deploy-production.yml",
    head_sha: sha,
    head_branch: "v2026.10.11-1",
    status: "completed",
    conclusion: "success",
    head_repository: { full_name: "RebuildingAmerica/atlas" },
  };
  assert.equal(
    validateRetainedRun(run, context, { runId: "123" }).head_sha,
    sha,
  );
  for (const patch of [
    { head_sha: "c".repeat(40) },
    { path: ".github/workflows/ci.yml" },
    { conclusion: "failure" },
    { head_branch: "chore/unsafe" },
    { head_repository: { full_name: "another/atlas" } },
  ])
    assert.throws(() =>
      validateRetainedRun({ ...run, ...patch }, context, { runId: "123" }),
    );
  assert.doesNotThrow(() =>
    validateRetainedRun({ ...run, conclusion: "failure" }, context, {
      runId: "123",
      recovery: true,
    }),
  );
  assert.doesNotThrow(() =>
    validateRetainedRun({ ...run, head_sha: "c".repeat(40) }, context, {
      runId: "123",
      previous: true,
    }),
  );
});
