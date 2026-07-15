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

test("hosted PDS deploy bundle includes the backup and restore operator script", async () => {
  const source = await workflowSource(
    ".github/actions/deploy-atlas-pds/action.yml",
  );

  assert.match(source, /vm-backup\.sh/);
  assert.match(source, /chmod 0755.*vm-backup\.sh/);
  assert.ok(
    source.indexOf("vm-backup.sh") < source.indexOf("vm-release.sh"),
    "backup operation should ship with the same host bundle as release",
  );
});
