import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GITHUB_VARIABLE_KEYS,
  githubVariablesFor,
  resolveGithubSecretValue,
} from "./infra-github.js";

void describe("GitHub Environment secret values", () => {
  void it("prefers the hosted env file over the root .env", () => {
    assert.equal(
      resolveGithubSecretValue(
        "ATLAS_AUTH_CALLBACK_SECRET",
        new Map([["ATLAS_AUTH_CALLBACK_SECRET", "hosted-callback"]]),
        new Map([["ATLAS_AUTH_CALLBACK_SECRET", "root-callback"]]),
      ),
      "hosted-callback",
    );
  });

  void it("falls back to the root .env when the hosted file lacks the key", () => {
    assert.equal(
      resolveGithubSecretValue(
        "ATLAS_AUTH_CALLBACK_SECRET",
        new Map(),
        new Map([["ATLAS_AUTH_CALLBACK_SECRET", "root-callback"]]),
      ),
      "root-callback",
    );
  });

  void it("never uploads a template placeholder", () => {
    assert.equal(
      resolveGithubSecretValue(
        "ATLAS_AUTH_CALLBACK_SECRET",
        new Map([
          [
            "ATLAS_AUTH_CALLBACK_SECRET",
            "replace-with-a-long-random-callback-secret",
          ],
        ]),
        new Map([["ATLAS_AUTH_CALLBACK_SECRET", "root-callback"]]),
      ),
      "root-callback",
    );
    assert.equal(
      resolveGithubSecretValue(
        "ATLAS_EDGE_ORIGIN_SECRET",
        new Map(),
        new Map([
          ["ATLAS_EDGE_ORIGIN_SECRET", "replace-with-a-local-edge-secret"],
        ]),
      ),
      undefined,
    );
  });

  void it("keeps a value the hosted file deliberately leaves empty unset", () => {
    assert.equal(
      resolveGithubSecretValue(
        "ATLAS_INSTANCE_OPERATOR_EMAILS",
        new Map([["ATLAS_INSTANCE_OPERATOR_EMAILS", ""]]),
        new Map([["ATLAS_INSTANCE_OPERATOR_EMAILS", "local@example.org"]]),
      ),
      undefined,
    );
  });
});

void describe("GitHub Environment variables", () => {
  void it("writes the operator lists and platform admin settings the deploys read", () => {
    const variables = githubVariablesFor(
      new Map([
        ["ATLAS_INSTANCE_OPERATOR_EMAILS", "editor@example.org"],
        ["ATLAS_PLATFORM_OPERATOR_EMAILS", "ops@example.org"],
        ["ATLAS_ADMIN_PUBLIC_URL", "https://atlas-admin.example.org"],
        ["ATLAS_ACCESS_AUD", ""],
        ["DATABASE_URL", "postgres://secret"],
      ]),
      new Map([
        ["ATLAS_ACCESS_AUD", "root-aud"],
        ["CLOUDFLARE_ACCOUNT_ID", "account-1"],
      ]),
    );

    assert.deepEqual(Object.fromEntries(variables), {
      ATLAS_ADMIN_PUBLIC_URL: "https://atlas-admin.example.org",
      ATLAS_INSTANCE_OPERATOR_EMAILS: "editor@example.org",
      ATLAS_PLATFORM_OPERATOR_EMAILS: "ops@example.org",
      CLOUDFLARE_ACCOUNT_ID: "account-1",
    });
  });

  void it("never writes the retired single allowlist", () => {
    assert.equal(
      (GITHUB_VARIABLE_KEYS as readonly string[]).includes(
        "ATLAS_OPERATOR_ALLOWED_EMAILS",
      ),
      false,
    );
  });
});
