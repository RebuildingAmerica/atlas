import { defineConfig } from "@playwright/test";

function hostedPublicUrl(): string {
  const value = process.env.ATLAS_HOSTED_PUBLIC_URL?.trim();
  if (!value) {
    throw new Error("ATLAS_HOSTED_PUBLIC_URL is required.");
  }
  return new URL(value).origin;
}

function trustedSourceHeaders(): Record<string, string> {
  const bypass = process.env.ATLAS_HOSTED_VERCEL_BYPASS_SECRET?.trim();
  const token = process.env.ATLAS_HOSTED_VERCEL_TRUSTED_OIDC_TOKEN?.trim();
  return {
    ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}),
    ...(token ? { "x-vercel-trusted-oidc-idp-token": token } : {}),
  };
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /atproto-identity-hosted\.spec\.ts/,
  timeout: 90_000,
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: hostedPublicUrl(),
    extraHTTPHeaders: trustedSourceHeaders(),
    headless: true,
    trace: "retain-on-failure",
  },
});
