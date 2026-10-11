import assert from "node:assert/strict";
import { test } from "node:test";
import { preserveRuntimeIdentity } from "./web-runtime-identity.mjs";
test("private runtime journal preserves credentials across candidate and canonical origins", () => {
  const runtime = {
    ATLAS_PUBLIC_URL: "https://atlas.example.com",
    ATLAS_AUTH_API_KEY_INTROSPECTION_URL:
      "https://atlas.example.com/api/auth/internal/api-key",
    ATLAS_AUTH_INTERNAL_SECRET: "unchanged-private-secret",
    STRIPE_API_KEY: "unchanged-stripe-key",
    ATLAS_ADMIN_PUBLIC_URL: "https://admin.example.com",
  };
  const sha = "a".repeat(40);
  const journal = preserveRuntimeIdentity(runtime, sha);
  assert.equal(JSON.stringify(journal).includes("unchanged"), false);
  assert.deepEqual(
    preserveRuntimeIdentity(
      {
        ...runtime,
        ATLAS_PUBLIC_URL: "https://candidate.atlas.example.com",
        ATLAS_WEB_CANONICAL_URL: runtime.ATLAS_PUBLIC_URL,
        ATLAS_PASSKEY_RP_ID: "atlas.example.com",
        ATLAS_AUTH_API_KEY_INTROSPECTION_URL:
          "https://candidate.atlas.example.com/api/auth/internal/api-key",
      },
      sha,
      journal,
    ),
    journal,
  );
  for (const patch of [
    { STRIPE_API_KEY: "replacement" },
    { ATLAS_ADMIN_PUBLIC_URL: "https://other.example.com" },
    { ATLAS_AUTH_INTERNAL_SECRET: "replacement" },
    { ATLAS_PASSKEY_RP_ID: "other.example.com" },
  ])
    assert.throws(
      () => preserveRuntimeIdentity({ ...runtime, ...patch }, sha, journal),
      /changed/,
    );
  assert.throws(
    () => preserveRuntimeIdentity(runtime, "b".repeat(40), journal),
    /another release/,
  );
});
