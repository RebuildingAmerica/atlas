import assert from "node:assert/strict";
import { test } from "node:test";
import { apiSettingsFromService } from "./api-cloudflare-settings.mjs";

const web = {
  DATABASE_URL: "postgres://private-fixture/db",
  ATLAS_AUTH_INTERNAL_SECRET: "private-fixture-secret",
  ATLAS_WEB_CANONICAL_URL: "https://atlas.example.org",
};
const values = {
  ENVIRONMENT: "production",
  DATABASE_BACKEND: "postgres",
  DATABASE_URL: web.DATABASE_URL,
  ATLAS_MULTI_USER: "true",
  ATLAS_MANAGED: "true",
  ATLAS_AUTH_INTERNAL_SECRET: web.ATLAS_AUTH_INTERNAL_SECRET,
  ATLAS_PUBLIC_URL: web.ATLAS_WEB_CANONICAL_URL,
  ATLAS_AUTH_API_KEY_INTROSPECTION_URL:
    "https://atlas.example.org/api/internal/auth",
  ATLAS_AUTH_MEMBERSHIP_URL:
    "https://atlas.example.org/api/internal/membership",
  ATLAS_AUTH_JWT_AUDIENCES: "https://atlas.example.org/mcp",
  ATLAS_EDGE_ORIGIN_SECRET: "private-origin-fixture",
  CORS_ORIGINS: '["https://atlas.example.org"]',
};
const service = (env) => ({
  spec: { template: { spec: { containers: [{ env }] } } },
});
const env = () =>
  Object.entries(values).map(([name, value]) => ({ name, value }));

test("production API export preserves identities and explicitly empty values", () => {
  const result = apiSettingsFromService(
    service([...env(), { name: "EMPTY" }]),
    web,
  );
  assert.deepEqual(result, { ...values, EMPTY: "" });
});

test("unresolved secrets, duplicate variables and identity changes fail without values", () => {
  for (const entries of [
    [...env(), { name: "UNRESOLVED", valueFrom: { secretKeyRef: {} } }],
    [...env(), { name: "DATABASE_URL", value: "duplicate-private-value" }],
    env().map((e) =>
      e.name === "DATABASE_URL"
        ? { ...e, value: "postgres://another-secret/db" }
        : e,
    ),
    env().map((e) =>
      e.name === "ATLAS_MULTI_USER" ? { ...e, value: "false" } : e,
    ),
  ]) {
    assert.throws(
      () => apiSettingsFromService(service(entries), web),
      (error) => {
        assert.doesNotMatch(
          error.message,
          /private-fixture|another-secret|duplicate-private/,
        );
        return true;
      },
    );
  }
});
