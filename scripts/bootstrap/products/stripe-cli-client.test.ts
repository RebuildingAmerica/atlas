import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  parseStripeCliProfiles,
  resolveStripeApiKey,
  selectStripeCliProfileKey,
} from "./stripe-cli-client.js";

const STRIPE_CONFIG = `
project-name = "default"

[default]
display_name = "The Rebuilding America Project"
live_mode_api_key = "rk_live_default"
test_mode_api_key = "sk_test_default"

['the rebuilding america project']
display_name = "The Rebuilding America Project"
profile_name = "The Rebuilding America Project"
live_mode_api_key = "rk_live_active"
test_mode_api_key = "sk_test_active"
`;

void describe("Stripe CLI config resolution", () => {
  void it("prefers the active Stripe CLI profile over the default section", () => {
    const profiles = parseStripeCliProfiles(STRIPE_CONFIG);

    assert.equal(
      selectStripeCliProfileKey(
        profiles,
        "The Rebuilding America Project",
        true,
      ),
      "rk_live_active",
    );
    assert.equal(
      selectStripeCliProfileKey(
        profiles,
        "The Rebuilding America Project",
        false,
      ),
      "sk_test_active",
    );
  });

  void it("falls back to the default profile when no active profile matches", () => {
    const profiles = parseStripeCliProfiles(STRIPE_CONFIG);

    assert.equal(
      selectStripeCliProfileKey(profiles, "Missing", true),
      "rk_live_default",
    );
  });

  void it("prefers explicit environment values before Stripe CLI config", () => {
    const original = process.env.STRIPE_API_KEY;
    const root = mkdtempSync(path.join(tmpdir(), "atlas-stripe-"));
    const targetEnv = path.join(root, ".env.production");
    writeFileSync(targetEnv, "STRIPE_API_KEY=sk_live_target\n");

    try {
      process.env.STRIPE_API_KEY = "sk_live_shell";
      assert.equal(
        resolveStripeApiKey(root, true, [targetEnv]),
        "sk_live_shell",
      );

      delete process.env.STRIPE_API_KEY;
      assert.equal(
        resolveStripeApiKey(root, true, [targetEnv]),
        "sk_live_target",
      );
    } finally {
      if (original === undefined) {
        delete process.env.STRIPE_API_KEY;
      } else {
        process.env.STRIPE_API_KEY = original;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  void it("does not use local fallback keys for live bootstrap", () => {
    const original = process.env.STRIPE_API_KEY;
    const root = mkdtempSync(path.join(tmpdir(), "atlas-stripe-"));
    writeFileSync(path.join(root, ".env"), "STRIPE_API_KEY=sk_test_root\n");

    try {
      delete process.env.STRIPE_API_KEY;
      assert.equal(resolveStripeApiKey(root, true, []), null);
    } finally {
      if (original === undefined) {
        delete process.env.STRIPE_API_KEY;
      } else {
        process.env.STRIPE_API_KEY = original;
      }
      rmSync(root, { recursive: true, force: true });
    }
  });
});
