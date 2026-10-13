import assert from "node:assert/strict";
import test from "node:test";
import { callbackSettings } from "./api-callback-configuration.mjs";
const runtime = {
  DATABASE_URL: "postgres://fixture/db",
  ATLAS_PUBLIC_URL: "https://atlas.example.org",
  ATLAS_AUTH_INTERNAL_SECRET: "signing",
  ATLAS_AUTH_CALLBACK_SECRET: "callback",
  ATLAS_EDGE_ORIGIN_SECRET: "edge",
};
const original = {
  ENVIRONMENT: "production",
  DATABASE_BACKEND: "postgres",
  DATABASE_URL: runtime.DATABASE_URL,
  ATLAS_MULTI_USER: "true",
  ATLAS_MANAGED: "true",
  ATLAS_PUBLIC_URL: runtime.ATLAS_PUBLIC_URL,
  ATLAS_AUTH_CALLBACK_SECRET: "callback",
  ATLAS_EDGE_ORIGIN_SECRET: "edge",
  ATLAS_AUTH_JWT_AUDIENCES: "https://atlas.example.org/mcp",
  CORS_ORIGINS: '["https://atlas.example.org"]',
  ATLAS_AUTH_MEMBERSHIP_URL: "https://atlas.example.org",
  ATLAS_AUTH_API_KEY_INTROSPECTION_URL:
    "https://atlas.example.org/api/auth/internal/api-keys/introspect",
};
const service = {
  spec: {
    template: {
      spec: {
        containers: [
          {
            env: Object.entries(original).map(([name, value]) => ({
              name,
              value,
            })),
          },
        ],
      },
    },
  },
};
const access = { client_id: "existing-id", client_secret: "existing-secret" };
test("candidate callbacks preserve canonical identity and promotion removes Access proof", () => {
  const candidate = callbackSettings({
    service,
    runtime,
    origin: "https://candidate.example.org",
    access,
  });
  assert.equal(
    candidate.ATLAS_AUTH_MEMBERSHIP_URL,
    "https://candidate.example.org/",
  );
  assert.equal(
    candidate.ATLAS_AUTH_API_KEY_INTROSPECTION_URL,
    "https://candidate.example.org/api/auth/internal/api-keys/introspect",
  );
  for (const key of [
    "ATLAS_PUBLIC_URL",
    "ATLAS_AUTH_JWT_AUDIENCES",
    "DATABASE_URL",
    "ATLAS_AUTH_CALLBACK_SECRET",
  ])
    assert.equal(candidate[key], original[key]);
  assert.equal(
    candidate.ATLAS_CALLBACK_ACCESS_CLIENT_SECRET,
    access.client_secret,
  );
  const canonical = callbackSettings({
    service,
    runtime,
    origin: runtime.ATLAS_PUBLIC_URL,
    access,
  });
  assert.equal(canonical.ATLAS_CALLBACK_ACCESS_CLIENT_SECRET, undefined);
  assert.equal(
    canonical.ATLAS_AUTH_API_KEY_INTROSPECTION_URL,
    original.ATLAS_AUTH_API_KEY_INTROSPECTION_URL,
  );
});
test("untrusted or incomplete callback targets fail before deployment", () => {
  for (const origin of [
    "http://candidate.example.org",
    "https://candidate.example.org/path",
    "https://user:secret@candidate.example.org",
    "https://candidate.example.org/",
  ])
    assert.throws(() => callbackSettings({ service, runtime, origin, access }));
  assert.throws(() =>
    callbackSettings({
      service,
      runtime,
      origin: "https://candidate.example.org",
    }),
  );
});
