import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveGithubSecretValue } from "./infra-github.js";

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
        "ATLAS_OPERATOR_ALLOWED_EMAILS",
        new Map([["ATLAS_OPERATOR_ALLOWED_EMAILS", ""]]),
        new Map([["ATLAS_OPERATOR_ALLOWED_EMAILS", "local@example.org"]]),
      ),
      undefined,
    );
  });
});
