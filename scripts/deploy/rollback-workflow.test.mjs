import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("production recovery remains manual and serialized with releases", async () => {
  const workflow = await source(".github/workflows/rollback-production.yml");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /source-run-id:/);
  assert.match(workflow, /group: deploy-production/);
  assert.match(workflow, /refs\/tags\/v\*/);
  assert.match(workflow, /operation: restore-routing/);
  assert.match(workflow, /cloudflare-publication\.yml/);
  assert.doesNotMatch(workflow, /cloud-run-release|vercel promote|gcloud/);
});

test("hosted publishing keeps the full CI gate and trusted refs for both environments", async () => {
  for (const target of ["production", "staging"]) {
    const workflow = await source(`.github/workflows/deploy-${target}.yml`);
    assert.match(workflow, /uses: \.\/\.github\/workflows\/ci\.yml/);
    assert.match(workflow, /profile: production/);
    assert.match(workflow, /needs: (?:ci|\[guard-production-ref, ci\])/);
    assert.match(workflow, /cloudflare-publication\.yml/);
    assert.doesNotMatch(
      workflow,
      /deploy-atlas-api|deploy-atlas-pds|vercel deploy|gcloud/,
    );
  }
});

test("release credentials stay in the protected job and retained artifacts are sealed first", async () => {
  const workflow = await source(".github/workflows/cloudflare-publication.yml");
  assert.match(workflow, /environment: \$\{\{ inputs\.target \}\}/);
  assert.match(
    workflow,
    /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN/,
  );
  assert.match(workflow, /cloudflare-publication\.mjs --seal/);
  assert.match(workflow, /steps\.retention\.outcome == 'success'/);
  assert.match(workflow, /include-hidden-files: true/);
  assert.doesNotMatch(workflow, /security find|gh auth|cf auth|gcloud auth/);
});
