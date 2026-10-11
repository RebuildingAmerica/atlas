import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/hosting",
  workers: 1,
  reporter: "list",
  use: { browserName: "chromium" },
});
