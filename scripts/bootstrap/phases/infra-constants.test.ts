import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PDS_APP_PROVISIONING_SECRET,
  REQUIRED_APIS,
  SERVICE_ACCOUNT_ROLES,
} from "./infra-constants.js";

void describe("GCP infrastructure constants", () => {
  void it("enables Secret Manager for deploy-time app provisioning", () => {
    assert.ok(REQUIRED_APIS.includes("secretmanager.googleapis.com"));
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
