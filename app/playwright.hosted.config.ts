import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // Both need a real browser, which this API-only smoke job does not install.
  testIgnore: /(atproto-identity|checkout)-hosted\.spec\.ts/,
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
});
