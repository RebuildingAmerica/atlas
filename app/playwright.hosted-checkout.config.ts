import { defineConfig } from "@playwright/test";

function hostedPublicUrl(): string {
  const value = process.env.ATLAS_HOSTED_PUBLIC_URL?.trim();
  if (!value) {
    throw new Error("ATLAS_HOSTED_PUBLIC_URL is required.");
  }
  return new URL(value).origin;
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /checkout-hosted\.spec\.ts/,
  timeout: 180_000,
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: hostedPublicUrl(),
    headless: true,
    trace: "retain-on-failure",
  },
});
