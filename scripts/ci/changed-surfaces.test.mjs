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
  assert.equal(outputs.browser_acceptance, false);
  assert.equal(outputs.stripe_acceptance, false);
  assert.equal(outputs.credential_scan, true);
});

test("ordinary app changes run browser acceptance without Stripe acceptance", () => {
  const outputs = outputsFor([
    "app/src/domains/catalog/pages/profile-page.tsx",
  ]);

  assert.equal(outputs.app_tests, true);
  assert.equal(outputs.browser_acceptance, true);
  assert.equal(outputs.stripe_acceptance, false);
  assert.equal(outputs.hosted_smoke, true);
  assert.equal(outputs.hosted_identity, false);
});

test("ATProto account app changes run hosted identity verification", () => {
  const outputs = outputsFor([
    "app/src/domains/access/server/atproto-oauth.ts",
  ]);

  assert.equal(outputs.app_tests, true);
  assert.equal(outputs.browser_acceptance, true);
  assert.equal(outputs.hosted_smoke, true);
  assert.equal(outputs.hosted_identity, true);
});

test("workspace organization identity changes run hosted identity verification", () => {
  const outputs = outputsFor([
    "app/src/domains/access/components/organization/atproto-identity-section.tsx",
  ]);

  assert.equal(outputs.app_tests, true);
  assert.equal(outputs.browser_acceptance, true);
  assert.equal(outputs.hosted_identity, true);
});

test("billing app changes run browser and Stripe acceptance", () => {
  const outputs = outputsFor([
    "app/src/domains/billing/server/webhook-handler.ts",
  ]);

  assert.equal(outputs.app_tests, true);
  assert.equal(outputs.browser_acceptance, true);
  assert.equal(outputs.stripe_acceptance, true);
});

test("billing acceptance spec changes run Stripe acceptance", () => {
  const outputs = outputsFor([
    "app/tests/acceptance/domains/billing/oobe.spec.ts",
  ]);

  assert.equal(outputs.browser_acceptance, true);
  assert.equal(outputs.stripe_acceptance, true);
});

test("Stripe setup changes run Stripe acceptance", () => {
  const outputs = outputsFor(["scripts/bootstrap/products/atlas/catalog.ts"]);

  assert.equal(outputs.browser_acceptance, false);
  assert.equal(outputs.stripe_acceptance, true);
});

test("API image inputs redeploy staging and run hosted smoke", () => {
  const outputs = outputsFor(["api/Dockerfile"]);

  assert.equal(outputs.deploy_scripts, true);
  assert.equal(outputs.staging_api_deploy, true);
  assert.equal(outputs.hosted_smoke, true);
});

test("managed PDS changes use the root deployment and hosted verification lanes", () => {
  const outputs = outputsFor(["services/atproto-pds/pds.env.example"]);

  assert.equal(outputs.compose, true);
  assert.equal(outputs.deploy_scripts, true);
  assert.equal(outputs.staging_pds_deploy, true);
  assert.equal(outputs.hosted_smoke, true);
  assert.equal(outputs.hosted_identity, true);
  assert.equal(outputs.browser_acceptance, false);
});

test("staging deploy workflow changes exercise the staging deploy path", () => {
  const outputs = outputsFor([".github/workflows/deploy-staging.yml"]);

  assert.equal(outputs.actions_lint, true);
  assert.equal(outputs.deploy_scripts, true);
  assert.equal(outputs.staging_api_deploy, true);
  assert.equal(outputs.hosted_smoke, true);
  assert.equal(outputs.hosted_identity, true);
});

test("trusted-source helper changes lint actions without running hosted smoke", () => {
  const outputs = outputsFor([
    ".github/actions/vercel-trusted-oidc/action.yml",
  ]);

  assert.equal(outputs.actions_lint, true);
  assert.equal(outputs.deploy_scripts, false);
  assert.equal(outputs.staging_api_deploy, false);
  assert.equal(outputs.hosted_smoke, false);
  assert.equal(outputs.hosted_identity, false);
});

test("CI classifier changes validate CI scripts without running app deploy gates", () => {
  const outputs = outputsFor(["scripts/ci/changed-surfaces.mjs"]);

  assert.equal(outputs.deploy_scripts, true);
  assert.equal(outputs.actions_lint, true);
  assert.equal(outputs.quality, false);
  assert.equal(outputs.browser_acceptance, false);
  assert.equal(outputs.stripe_acceptance, false);
  assert.equal(outputs.staging_api_deploy, false);
  assert.equal(outputs.hosted_smoke, false);
  assert.equal(outputs.hosted_identity, false);
});

test("docs-only changes do not run hosted identity verification", () => {
  const outputs = outputsFor(["docs/deployment/staging.md"]);

  assert.equal(outputs.docs, true);
  assert.equal(outputs.hosted_identity, false);
});

test("manual workflow runs include hosted identity verification", () => {
  const outputs = classifyChangedFiles([], { eventName: "workflow_dispatch" }).outputs;

  assert.equal(outputs.hosted_identity, true);
});

test("production-only deploy workflow changes do not redeploy staging", () => {
  const outputs = outputsFor([".github/workflows/deploy-production.yml"]);

  assert.equal(outputs.actions_lint, true);
  assert.equal(outputs.deploy_scripts, true);
  assert.equal(outputs.staging_api_deploy, false);
  assert.equal(outputs.hosted_smoke, false);
  assert.equal(outputs.stripe_acceptance, false);
});
