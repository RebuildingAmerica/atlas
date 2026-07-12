import test from "node:test";
import assert from "node:assert/strict";

import { classifyChangedFiles } from "./changed-surfaces.mjs";

function outputsFor(files) {
  return classifyChangedFiles(files, { eventName: "push" }).outputs;
}

test("deploy helper scripts validate without redeploying staging", () => {
  const outputs = outputsFor(["scripts/deploy/prod-verify.sh"]);

  assert.equal(outputs.deploy_scripts, true);
  assert.equal(outputs.staging_api_deploy, false);
  assert.equal(outputs.hosted_smoke, false);
  assert.equal(outputs.credential_scan, true);
});

test("API image inputs redeploy staging and run hosted smoke", () => {
  const outputs = outputsFor(["api/Dockerfile"]);

  assert.equal(outputs.deploy_scripts, true);
  assert.equal(outputs.staging_api_deploy, true);
  assert.equal(outputs.hosted_smoke, true);
});

test("staging deploy workflow changes exercise the staging deploy path", () => {
  const outputs = outputsFor([".github/workflows/deploy-staging.yml"]);

  assert.equal(outputs.actions_lint, true);
  assert.equal(outputs.deploy_scripts, true);
  assert.equal(outputs.staging_api_deploy, true);
  assert.equal(outputs.hosted_smoke, true);
});

test("production-only deploy workflow changes do not redeploy staging", () => {
  const outputs = outputsFor([".github/workflows/deploy-production.yml"]);

  assert.equal(outputs.actions_lint, true);
  assert.equal(outputs.deploy_scripts, true);
  assert.equal(outputs.staging_api_deploy, false);
  assert.equal(outputs.hosted_smoke, false);
});
