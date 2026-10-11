import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PRODUCTION_API_ORIGIN,
  buildVercelEnvVars,
  formatMintlifyDocsOriginPromptMessage,
  formatProductionApiProxyPromptMessage,
  formatProductionAppUrlPromptMessage,
  resolveHostedOriginPromptValue,
} from "./env-routing.js";

void describe("hosted routing prompts", () => {
  void it("uses the shown production API default when the submitted value is blank", () => {
    assert.equal(
      resolveHostedOriginPromptValue(
        "",
        DEFAULT_PRODUCTION_API_ORIGIN,
        "ATLAS_SERVER_API_PROXY_TARGET",
      ),
      DEFAULT_PRODUCTION_API_ORIGIN,
    );
  });

  void it("explains the production app URL prompt at the point of entry", () => {
    const message = formatProductionAppUrlPromptMessage();

    assert.match(message, /Open the Vercel project/);
    assert.match(message, /Press Enter to accept the shown default/);
    assert.match(message, /ATLAS_PUBLIC_URL/);
  });

  void it("explains the API proxy origin prompt at the point of entry", () => {
    const message = formatProductionApiProxyPromptMessage();

    assert.match(message, /proxy \/api traffic/);
    assert.match(message, /Do not paste a path/);
    assert.match(message, /ATLAS_SERVER_API_PROXY_TARGET/);
  });

  void it("explains the Mintlify docs origin prompt at the point of entry", () => {
    const message = formatMintlifyDocsOriginPromptMessage();

    assert.match(message, /Open the Mintlify project dashboard/);
    assert.match(message, /Host at \/docs/);
    assert.match(message, /ATLAS_DOCS_URL/);
  });

  void it("only builds production vars for a production-targeted sync, never preview", () => {
    const vars = buildVercelEnvVars(
      "production",
      new Map([["ATLAS_OPERATOR_ALLOWED_EMAILS", "prod-operator@example.org"]]),
      new Map([
        ["ATLAS_OPERATOR_ALLOWED_EMAILS", "staging-operator@example.org"],
      ]),
    );

    assert.deepEqual(
      vars.find((item) => item.key === "ATLAS_OPERATOR_ALLOWED_EMAILS"),
      {
        key: "ATLAS_OPERATOR_ALLOWED_EMAILS",
        value: "prod-operator@example.org",
        environments: ["production"],
      },
    );
    assert.equal(
      vars.some((item) => item.environments.includes("preview")),
      false,
    );
  });

  void it("only builds preview vars for a staging-targeted sync, never production", () => {
    const vars = buildVercelEnvVars(
      "staging",
      new Map([["ATLAS_OPERATOR_ALLOWED_EMAILS", "prod-operator@example.org"]]),
      new Map([
        ["ATLAS_OPERATOR_ALLOWED_EMAILS", "staging-operator@example.org"],
      ]),
    );

    assert.deepEqual(
      vars.find((item) => item.key === "ATLAS_OPERATOR_ALLOWED_EMAILS"),
      {
        key: "ATLAS_OPERATOR_ALLOWED_EMAILS",
        value: "staging-operator@example.org",
        environments: ["preview"],
      },
    );
    assert.equal(
      vars.some((item) => item.environments.includes("production")),
      false,
    );
  });

  void it("syncs the callback and edge origin secrets the app server now requires", () => {
    const sharedSecretKeys = [
      "ATLAS_AUTH_INTERNAL_SECRET",
      "ATLAS_AUTH_CALLBACK_SECRET",
      "ATLAS_EDGE_ORIGIN_SECRET",
    ];
    const productionEnv = new Map([
      ["ATLAS_AUTH_INTERNAL_SECRET", "prod-internal"],
      ["ATLAS_AUTH_CALLBACK_SECRET", "prod-callback"],
      ["ATLAS_EDGE_ORIGIN_SECRET", "prod-edge"],
    ]);
    const stagingEnv = new Map([
      ["ATLAS_AUTH_INTERNAL_SECRET", "staging-internal"],
      ["ATLAS_AUTH_CALLBACK_SECRET", "staging-callback"],
      ["ATLAS_EDGE_ORIGIN_SECRET", "staging-edge"],
    ]);

    const pick = (vars: ReturnType<typeof buildVercelEnvVars>) =>
      vars.filter((item) => sharedSecretKeys.includes(item.key));

    assert.deepEqual(
      pick(buildVercelEnvVars("production", productionEnv, stagingEnv)),
      [
        {
          key: "ATLAS_AUTH_INTERNAL_SECRET",
          value: "prod-internal",
          environments: ["production"],
        },
        {
          key: "ATLAS_AUTH_CALLBACK_SECRET",
          value: "prod-callback",
          environments: ["production"],
        },
        {
          key: "ATLAS_EDGE_ORIGIN_SECRET",
          value: "prod-edge",
          environments: ["production"],
        },
      ],
    );
    assert.deepEqual(
      pick(buildVercelEnvVars("staging", productionEnv, stagingEnv)),
      [
        {
          key: "ATLAS_AUTH_INTERNAL_SECRET",
          value: "staging-internal",
          environments: ["preview"],
        },
        {
          key: "ATLAS_AUTH_CALLBACK_SECRET",
          value: "staging-callback",
          environments: ["preview"],
        },
        {
          key: "ATLAS_EDGE_ORIGIN_SECRET",
          value: "staging-edge",
          environments: ["preview"],
        },
      ],
    );
  });

  void it("does not sync a template placeholder as a secret", () => {
    const vars = buildVercelEnvVars(
      "production",
      new Map([
        [
          "ATLAS_AUTH_CALLBACK_SECRET",
          "replace-with-a-long-random-callback-secret",
        ],
      ]),
    );

    assert.equal(
      vars.some((item) => item.key === "ATLAS_AUTH_CALLBACK_SECRET"),
      false,
    );
  });

  void it("syncs staging routing values to Vercel Preview only", () => {
    const vars = buildVercelEnvVars(
      "staging",
      new Map([
        ["DATABASE_BACKEND", "postgres"],
        ["DATABASE_URL", "postgresql://prod.example.org/atlas"],
        ["ATLAS_PUBLIC_URL", "https://atlas.example.org"],
        ["ATLAS_PDS_PUBLIC_URL", "https://atlas-pds.example.org"],
        ["ATLAS_SERVER_API_PROXY_TARGET", "https://api.atlas.example.org"],
        ["ATLAS_AUTH_JWT_AUDIENCES", "https://atlas.example.org/mcp"],
      ]),
      new Map([
        ["DATABASE_BACKEND", "postgres"],
        ["DATABASE_URL", "postgresql://staging.example.org/atlas"],
        ["ATLAS_PUBLIC_URL", "https://atlas-staging.example.org"],
        ["ATLAS_PDS_PUBLIC_URL", "https://atlas-pds-staging.example.org"],
        [
          "ATLAS_SERVER_API_PROXY_TARGET",
          "https://atlas-api-staging.example.org",
        ],
        [
          "ATLAS_AUTH_JWT_AUDIENCES",
          "https://atlas-staging.example.org/mcp,https://atlas-api-staging.example.org",
        ],
      ]),
    );

    assert.equal(
      vars.some((item) => item.environments.includes("production")),
      false,
    );
    assert.deepEqual(
      vars
        .map((item): [string, string] => [item.key, item.value])
        .filter(([key]) =>
          [
            "DATABASE_BACKEND",
            "DATABASE_URL",
            "ATLAS_PUBLIC_URL",
            "ATLAS_PDS_PUBLIC_URL",
            "ATLAS_SERVER_API_PROXY_TARGET",
            "ATLAS_AUTH_JWT_AUDIENCES",
          ].includes(key),
        ),
      [
        ["DATABASE_BACKEND", "postgres"],
        ["DATABASE_URL", "postgresql://staging.example.org/atlas"],
        ["ATLAS_PUBLIC_URL", "https://atlas-staging.example.org"],
        ["ATLAS_PDS_PUBLIC_URL", "https://atlas-pds-staging.example.org"],
        [
          "ATLAS_SERVER_API_PROXY_TARGET",
          "https://atlas-api-staging.example.org",
        ],
        [
          "ATLAS_AUTH_JWT_AUDIENCES",
          "https://atlas-staging.example.org/mcp,https://atlas-api-staging.example.org",
        ],
      ],
    );
  });
});
