import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function workflowSource(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("CI exposes the staging PDS deployment decision to caller workflows", async () => {
  const source = await workflowSource(".github/workflows/ci.yml");

  assert.match(source, /staging_pds_deploy:/);
  assert.match(
    source,
    /value: \$\{\{ jobs\.changes\.outputs\.staging_pds_deploy \}\}/,
  );
  assert.match(
    source,
    /staging_pds_deploy: \$\{\{ steps\.classify\.outputs\.staging_pds_deploy \}\}/,
  );
});

test("staging deploy consumes the PDS decision with a hosted PDS release job", async () => {
  const source = await workflowSource(".github/workflows/deploy-staging.yml");

  assert.match(source, /deploy-pds:/);
  assert.match(source, /needs\.ci\.outputs\.staging_pds_deploy == 'true'/);
  assert.match(source, /\.\/\.github\/actions\/deploy-atlas-pds/);
  assert.match(source, /atlas-pds-staging\.rebuildingus\.org/);
});

test("staging API deploy enables the ATProto OAuth harness for hosted identity proof", async () => {
  const workflow = await workflowSource(".github/workflows/deploy-staging.yml");
  const action = await workflowSource(
    ".github/actions/deploy-atlas-api/action.yml",
  );

  assert.match(workflow, /atproto-oauth-e2e-harness: "1"/);
  assert.match(action, /atproto-oauth-e2e-harness:/);
  assert.match(
    action,
    /ATLAS_ATPROTO_OAUTH_E2E_HARNESS=\$\{\{ inputs\.atproto-oauth-e2e-harness \}\}/,
  );
});

test("staging hosted identity proof runs against a branch app without Vercel deploy credentials", async () => {
  const source = await workflowSource(".github/workflows/deploy-staging.yml");
  const hostedIdentityJob = source.slice(source.indexOf("hosted-identity:"));

  assert.doesNotMatch(source, /VERCEL_TOKEN/);
  assert.doesNotMatch(source, /Deploy Vercel staging app/);
  assert.match(source, /Start branch app for hosted identity verification/);
  assert.match(source, /ATLAS_ATPROTO_OAUTH_E2E_HARNESS=1/);
  assert.match(source, /ATLAS_HOSTED_E2E_PRODUCTION_ENABLED=1/);
  assert.doesNotMatch(hostedIdentityJob, /python: "false"/);
  assert.match(source, /ATLAS_PDS_INVITE_BROKER_SECRET/);
  assert.match(source, /ATLAS_PDS_INVITE_BROKER_URL/);
  assert.ok(
    source.indexOf("Start branch app for hosted identity verification") <
      source.indexOf("Run hosted ATProto identity verification"),
    "hosted identity proof must hit the branch app started by the workflow",
  );
  assert.match(
    source,
    /ATLAS_HOSTED_PUBLIC_URL: http:\/\/127\.0\.0\.1:3100/,
  );
  assert.match(
    source,
    /ATLAS_HOSTED_EXPECTED_PUBLIC_URL: http:\/\/127\.0\.0\.1:3100/,
  );
});

test("manual staging deploy can verify a fresh hosted preview URL", async () => {
  const source = await workflowSource(".github/workflows/deploy-staging.yml");

  assert.match(source, /hosted_public_url:/);
  assert.match(
    source,
    /ATLAS_HOSTED_PUBLIC_URL: \$\{\{ github\.event\.inputs\.hosted_public_url \|\| secrets\.ATLAS_PUBLIC_URL \}\}/,
  );
  assert.match(
    source,
    /ATLAS_HOSTED_EXPECTED_PUBLIC_URL: \$\{\{ secrets\.ATLAS_PUBLIC_URL \}\}/,
  );
});

test("production deploy releases the hosted PDS before hosted smoke", async () => {
  const source = await workflowSource(
    ".github/workflows/deploy-production.yml",
  );

  assert.match(source, /\.\/\.github\/actions\/deploy-atlas-pds/);
  assert.match(source, /atlas-pds\.rebuildingus\.org/);
  assert.match(source, /Run hosted Cloudflare API smoke/);
  assert.ok(
    source.indexOf("./.github/actions/deploy-atlas-pds") <
      source.indexOf("Run hosted Cloudflare API smoke"),
  );
});

test("production deploy avoids reading PDS admin secrets in GitHub", async () => {
  const source = await workflowSource(
    ".github/workflows/deploy-production.yml",
  );

  assert.doesNotMatch(source, /pds-secret-preflight:/);
  assert.doesNotMatch(source, /atlas-pds-production-admin-password/);
  assert.doesNotMatch(source, /ATLAS_PDS_ADMIN_PASSWORD/);
  assert.match(
    source,
    /ci:\s*\n\s*needs:\s*\n\s*- guard-production-ref/,
  );
});

test("production deploy runs signed-in hosted identity proof after hosted smoke", async () => {
  const source = await workflowSource(
    ".github/workflows/deploy-production.yml",
  );

  assert.match(source, /hosted-identity:/);
  assert.match(source, /needs:\s*\n\s*- hosted-smoke/);
  assert.match(source, /Run hosted ATProto identity verification/);
  assert.match(
    source,
    /ATLAS_HOSTED_E2E_SECRET: \$\{\{ secrets\.ATLAS_HOSTED_E2E_SECRET \}\}/,
  );
  assert.match(
    source,
    /ATLAS_HOSTED_E2E_RUN_ID: \$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/,
  );
  assert.match(
    source,
    /pnpm --filter @rebuildingamerica\/atlas-app run test:hosted-identity/,
  );
  assert.ok(
    source.indexOf("Run hosted Cloudflare API smoke") <
      source.indexOf("Run hosted ATProto identity verification"),
  );
});

test("production deploy configures the hosted identity helper in Vercel", async () => {
  const source = await workflowSource(
    ".github/workflows/deploy-production.yml",
  );

  assert.match(source, /Generate PDS invite broker secret/);
  assert.match(source, /ATLAS_PDS_INVITE_BROKER_SECRET/);
  assert.match(source, /ATLAS_PDS_INVITE_BROKER_URL/);
  assert.match(source, /\/_atlas\/pds\/invites/);
  assert.match(
    source,
    /ATLAS_HOSTED_E2E_SECRET: \$\{\{ secrets\.ATLAS_HOSTED_E2E_SECRET \}\}/,
  );
  assert.match(source, /add_vercel_env ATLAS_HOSTED_E2E_ENABLED "1"/);
  assert.match(
    source,
    /add_vercel_env ATLAS_HOSTED_E2E_PRODUCTION_ENABLED "1"/,
  );
  assert.match(
    source,
    /add_vercel_env ATLAS_HOSTED_E2E_SECRET "\$ATLAS_HOSTED_E2E_SECRET"/,
  );
  assert.match(
    source,
    /add_vercel_env ATLAS_PDS_INVITE_BROKER_SECRET "\$ATLAS_PDS_INVITE_BROKER_SECRET"/,
  );
  assert.match(
    source,
    /add_vercel_env ATLAS_PDS_INVITE_BROKER_URL "\$atlas_pds_invite_broker_url"/,
  );
  assert.doesNotMatch(source, /add_vercel_env ATLAS_PDS_ADMIN_PASSWORD/);
});

test("production deploy updates the PDS invite broker before promoting the app", async () => {
  const source = await workflowSource(
    ".github/workflows/deploy-production.yml",
  );

  assert.match(source, /invite-broker-secret: \$\{\{ steps\.pds-invite-broker\.outputs\.secret \}\}/);
  assert.ok(
    source.indexOf("./.github/actions/deploy-atlas-pds") <
      source.indexOf("Deploy Vercel production app"),
    "PDS broker must accept the generated secret before the Vercel app is promoted with it",
  );
});

test("hosted identity jobs keep Playwright traces when production or staging proof fails", async () => {
  for (const workflowPath of [
    ".github/workflows/deploy-production.yml",
    ".github/workflows/deploy-staging.yml",
  ]) {
    const source = await workflowSource(workflowPath);

    assert.match(source, /artifact-metadata: write/);
    assert.match(source, /Upload hosted identity Playwright traces/);
    assert.match(
      source,
      /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/,
    );
    assert.match(source, /path: app\/test-results\//);
    assert.match(source, /if-no-files-found: ignore/);
  }
});

test("hosted PDS deploy bundle includes the backup, restore, and invite broker scripts", async () => {
  const source = await workflowSource(
    ".github/actions/deploy-atlas-pds/action.yml",
  );

  assert.match(source, /vm-backup\.sh/);
  assert.match(source, /invite-broker\.mjs/);
  assert.match(source, /chmod 0755.*vm-backup\.sh/);
  assert.ok(
    source.indexOf("vm-backup.sh") < source.indexOf("vm-release.sh"),
    "backup operation should ship with the same host bundle as release",
  );
});

test("hosted PDS deploy uploads each release bundle to a unique remote path", async () => {
  const source = await workflowSource(
    ".github/actions/deploy-atlas-pds/action.yml",
  );

  assert.match(
    source,
    /remote_archive="\/tmp\/atlas-pds-release-\$\{GITHUB_RUN_ID:-manual\}-\$\{GITHUB_RUN_ATTEMPT:-0\}-\$\{GITHUB_RUN_NUMBER:-0\}\.tgz"/,
  );
  assert.match(source, /ATLAS_PDS_REMOTE_ARCHIVE=\$remote_archive/);
  assert.match(
    source,
    /gcloud compute scp "\$archive" "\$\{INSTANCE_NAME\}:\$\{remote_archive\}"/,
  );
  assert.match(source, /sudo tar -xzf "\\\$remote_archive"/);
  assert.doesNotMatch(source, /:\/tmp\/atlas-pds-release\.tgz/);
  assert.doesNotMatch(source, /tar -xzf \/tmp\/atlas-pds-release\.tgz/);
});
