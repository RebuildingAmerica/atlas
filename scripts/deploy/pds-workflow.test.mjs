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

test("production deploy releases the hosted PDS before hosted smoke", async () => {
  const source = await workflowSource(".github/workflows/deploy-production.yml");

  assert.match(source, /\.\/\.github\/actions\/deploy-atlas-pds/);
  assert.match(source, /atlas-pds\.rebuildingus\.org/);
  assert.match(source, /Run hosted Cloudflare API smoke/);
  assert.ok(
    source.indexOf("./.github/actions/deploy-atlas-pds")
      < source.indexOf("Run hosted Cloudflare API smoke"),
  );
});

test("hosted PDS deploy bundle includes the backup and restore operator script", async () => {
  const source = await workflowSource(".github/actions/deploy-atlas-pds/action.yml");

  assert.match(source, /vm-backup\.sh/);
  assert.match(source, /chmod 0755.*vm-backup\.sh/);
  assert.ok(
    source.indexOf("vm-backup.sh") < source.indexOf("vm-release.sh"),
    "backup operation should ship with the same host bundle as release",
  );
});
