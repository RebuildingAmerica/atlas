import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatAuthenticatedAccountPrompt,
  shouldAcceptAuthenticatedAccount,
  shouldShowAuthenticatedAccountStatus,
  parseAuthIdentity,
} from "./auth.js";

void describe("bootstrap auth identity parsing", () => {
  void it("shows the active gcloud account", () => {
    assert.equal(
      parseAuthIdentity("deploy-gcloud", "admin@example.test\n"),
      "admin@example.test",
    );
  });

  void it("shows the GitHub login from the CLI API response", () => {
    assert.equal(
      parseAuthIdentity("deploy-gh", '{"login":"atlas-admin","id":123}'),
      "atlas-admin",
    );
  });

  void it("shows the Stripe account display name, email, and id", () => {
    assert.equal(
      parseAuthIdentity(
        "product-stripe",
        JSON.stringify({
          id: "acct_123",
          email: "billing@example.test",
          settings: { dashboard: { display_name: "Atlas Billing" } },
        }),
      ),
      "Atlas Billing / billing@example.test / acct_123",
    );
  });

  void it("shows the Cloudflare account table identity", () => {
    assert.equal(
      parseAuthIdentity(
        "deploy-wrangler",
        `
 ⛅️ wrangler 4.107.1
────────────────────
┌──────────────┬──────────────────────────────────┐
│ Account Name │ Account ID                       │
├──────────────┼──────────────────────────────────┤
│ Atlas Cloud  │ 0123456789abcdef0123456789abcdef │
└──────────────┴──────────────────────────────────┘
`,
      ),
      "Atlas Cloud / 0123456789abcdef0123456789abcdef",
    );
  });

  void it("shows the Neon user id and email from JSON output", () => {
    assert.equal(
      parseAuthIdentity(
        "product-neonctl",
        '{"id":"user_123","email":"data@example.test"}',
      ),
      "user_123 / data@example.test",
    );
  });

  void it("shows the Vercel account slug", () => {
    assert.equal(
      parseAuthIdentity("deploy-vercel", "atlas-team\n"),
      "atlas-team",
    );
  });

  void it("formats account details inside the confirmation prompt", () => {
    assert.equal(
      formatAuthenticatedAccountPrompt({
        label: "Google Cloud SDK",
        identity: "admin@example.test",
      }),
      [
        "Use this Google Cloud SDK account?",
        "",
        "Account: admin@example.test",
        "",
        "Choose Yes only if this is the account Atlas should use for setup.",
        "Choose No to log in with a different account before bootstrap continues.",
      ].join("\n"),
    );
  });

  void it("stops at the first declined account unless assume-yes is enabled", () => {
    assert.equal(shouldAcceptAuthenticatedAccount(false, false), false);
    assert.equal(shouldAcceptAuthenticatedAccount(false, true), true);
    assert.equal(shouldAcceptAuthenticatedAccount(true, false), true);
  });

  void it("does not print per-account success rows during normal bootstrap", () => {
    assert.equal(shouldShowAuthenticatedAccountStatus(false), false);
    assert.equal(shouldShowAuthenticatedAccountStatus(true), true);
  });
});
