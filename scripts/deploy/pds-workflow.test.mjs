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

for (const target of ["production", "staging"]) {
  test(`${target} publishes through protected Cloudflare automation after full CI`, async () => {
    const source = await workflowSource(
      `.github/workflows/deploy-${target}.yml`,
    );
    assert.match(source, /needs: guard-(production|staging)-ref/);
    assert.match(source, /profile: production/);
    assert.match(source, /publish:\s*\n\s*needs: ci/);
    assert.match(
      source,
      /uses: \.\/\.github\/workflows\/cloudflare-publication.yml/,
    );
    assert.match(source, new RegExp(`target: ${target}`));
    assert.match(
      source,
      /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/,
    );
    assert.doesNotMatch(
      source,
      /deploy-atlas-pds|gcloud|ATLAS_PDS_ADMIN_PASSWORD/,
    );
    assert.doesNotMatch(source, /restore-pds/);
  });
}

test("publication preserves the existing PDS broker and account verification credentials", async () => {
  const source = await workflowSource(
    ".github/workflows/cloudflare-publication.yml",
  );
  const publication = await workflowSource(
    "scripts/deploy/cloudflare-publication.mjs",
  );
  assert.match(
    source,
    /ATLAS_PDS_INVITE_BROKER_SECRET: \$\{\{ secrets\.ATLAS_PDS_INVITE_BROKER_SECRET \}\}/,
  );
  assert.match(
    source,
    /ATLAS_HOSTED_E2E_SECRET: \$\{\{ secrets\.ATLAS_HOSTED_E2E_SECRET \}\}/,
  );
  assert.match(publication, /ATLAS_PDS_PUBLIC_URL/);
  assert.match(publication, /ATLAS_PDS_INVITE_BROKER_URL/);
  assert.doesNotMatch(
    publication,
    /ATLAS_PDS_ADMIN_PASSWORD|randomBytes|ATLAS_ATPROTO_OAUTH_E2E_HARNESS/,
  );
  assert.doesNotMatch(source, /Generate.*secret|vercel deploy|gcloud/);
});

test("doctor checks the PDS read-only and normal web deployment converges it after billing preflight", async () => {
  const source = await workflowSource(
    ".github/workflows/cloudflare-publication.yml",
  );
  assert.match(source, /id-token: write/);
  const deployment = source.indexOf("uses: ./.github/actions/deploy-atlas-pds");
  const preflight = source.indexOf("id: pds-release-config");
  assert.ok(preflight >= 0 && deployment > preflight);
  assert.match(
    source,
    /if: inputs.operation == 'web-candidate' \|\| inputs.operation == 'doctor'\n\s*uses: \.\/\.github\/actions\/deploy-atlas-pds/,
  );
  assert.match(
    source,
    /mode: \$\{\{ inputs.operation == 'doctor' && 'check' \|\| 'full' \}\}/,
  );
  assert.match(
    source,
    /if \(context.operation === 'web-candidate' && context.target === 'production'\)/,
  );
  for (const setting of [
    "GCP_PROJECT_ID",
    "GCP_WORKLOAD_IDENTITY_PROVIDER",
    "GCP_SERVICE_ACCOUNT",
    "ATLAS_PDS_INSTANCE_NAME",
    "ATLAS_PDS_INSTANCE_ZONE",
    "ATLAS_PDS_INVITE_BROKER_SECRET",
  ])
    assert.ok(source.includes(`secrets.${setting}`), setting);
  assert.ok(
    deployment <
      source.indexOf("run: node scripts/deploy/cloudflare-publication.mjs\n"),
  );
  assert.doesNotMatch(source, /deploy-atlas-api|Generate.*secret/);
});

test("hosted verification retains encrypted failure traces only after scanning artifacts", async () => {
  const source = await workflowSource(
    ".github/workflows/cloudflare-publication.yml",
  );
  assert.match(source, /artifact-metadata: write/);
  assert.match(
    source,
    /if: always\(\)\n\s*run: node scripts\/deploy\/hosted-traces.mjs/,
  );
  assert.match(source, /steps\.retention\.outcome == 'success'/);
  assert.match(
    source,
    /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/,
  );
  assert.match(source, /path: \.atlas\/cloudflare-release\//);
  assert.doesNotMatch(source, /path: app\/test-results/);
  assert.ok(
    source.indexOf("hosted-traces.mjs") <
      source.indexOf("cloudflare-publication.mjs --seal"),
  );
  assert.ok(
    source.indexOf("cloudflare-publication.mjs --seal") <
      source.indexOf("cloudflare-publication.mjs --cleanup"),
  );
  assert.ok(
    source.indexOf("cloudflare-publication.mjs --cleanup") <
      source.indexOf("actions/upload-artifact@"),
  );
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

test("hosted PDS deploy verifies the public invite broker route", async () => {
  const source = await workflowSource(
    ".github/actions/deploy-atlas-pds/action.yml",
  );

  assert.match(source, /Verify public PDS invite broker route/);
  assert.match(
    source,
    /node scripts\/deploy\/pds-release\.mjs invite-broker-route/,
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
