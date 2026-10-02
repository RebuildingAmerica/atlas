import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // tests/e2e also holds Vitest unit tests (*.test.ts) for the helpers these
  // specs use; Playwright must collect only the hosted specs.
  testMatch: /-hosted\.spec\.ts$/,
  // Both need a browser; this job is API-only.
  testIgnore: /(atproto-identity|checkout)-hosted\.spec\.ts/,
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
});
