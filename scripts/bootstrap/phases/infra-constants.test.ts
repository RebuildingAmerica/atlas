import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PDS_APP_PROVISIONING_SECRET,
  REQUIRED_APIS,
  SA_NAME,
  SCHEDULER_SA_NAME,
  SERVICE_ACCOUNT_ROLES,
} from "./infra-constants.js";

void describe("GCP infrastructure constants", () => {
  void it("enables Secret Manager for deploy-time app provisioning", () => {
    assert.ok(REQUIRED_APIS.includes("secretmanager.googleapis.com"));
  });

  void it("enables Cloud Scheduler for the nightly discovery run", () => {
    assert.ok(REQUIRED_APIS.includes("cloudscheduler.googleapis.com"));
  });

  void it("keeps the scheduler account separate from the deploy account", () => {
    assert.equal(SCHEDULER_SA_NAME, "atlas-scheduler");
    assert.notEqual(SCHEDULER_SA_NAME, SA_NAME);
  });

  void it("keeps deploy app provisioning access scoped to the production PDS admin secret", () => {
    assert.equal(
      PDS_APP_PROVISIONING_SECRET,
      "atlas-pds-production-admin-password",
    );
    assert.ok(!SERVICE_ACCOUNT_ROLES.includes("roles/secretmanager.admin"));
    assert.ok(
      !SERVICE_ACCOUNT_ROLES.includes("roles/secretmanager.secretAccessor"),
    );
  });
});
