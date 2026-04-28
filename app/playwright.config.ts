import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const e2eEnvFile = path.join(process.cwd(), ".env.e2e");
if (existsSync(e2eEnvFile)) {
  process.loadEnvFile(e2eEnvFile);
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for Playwright end-to-end runs.`);
  }

  return value;
}

const e2eDir = path.join(process.cwd(), "node_modules", ".cache", "e2e");
const repoRoot = path.join(process.cwd(), "..");
const apiDbPath = path.join(e2eDir, "atlas-api.sqlite");
const authDbPath = path.join(e2eDir, "atlas-auth.sqlite");
const mailboxFile = path.join(e2eDir, "mailbox.json");
const appUrl = requireEnv("ATLAS_E2E_APP_URL");
const apiUrl = requireEnv("ATLAS_E2E_API_URL");
const mailboxUrl = requireEnv("ATLAS_E2E_MAILBOX_URL");
const authIntrospectionUrl = requireEnv("ATLAS_E2E_AUTH_INTROSPECTION_URL");
const apiPort = new URL(apiUrl).port;
if (!apiPort) {
  throw new Error("ATLAS_E2E_API_URL must include an explicit port.");
}
const e2eInternalSecret = randomBytes(32).toString("hex");
const baseWebServerEnv = { ...process.env };
delete baseWebServerEnv.NO_COLOR;
delete baseWebServerEnv.FORCE_COLOR;
// In CI, skip the portless DNS shim — the mail capture server only needs to
// listen on localhost, and portless requires a writable /etc/hosts.
const mailServerCommand = process.env.CI
  ? "pnpm --filter @rebuildingamerica/atlas-app e2e:mail:ci"
  : "pnpm --filter @rebuildingamerica/atlas-app e2e:mail";
const commonAuthEnv = {
  ATLAS_AUTH_ALLOWED_EMAILS: "operator@atlas.test",
  ATLAS_AUTH_API_KEY_INTROSPECTION_URL: authIntrospectionUrl,
  ATLAS_AUTH_BASE_PATH: "/api/auth",
  ATLAS_AUTH_INTERNAL_SECRET: e2eInternalSecret,
  ATLAS_DEPLOY_MODE: "production",
  ATLAS_EMAIL_CAPTURE_URL: `${mailboxUrl}/messages`,
  ATLAS_EMAIL_FROM: "Atlas <noreply@localhost>",
  ATLAS_EMAIL_PROVIDER: "capture",
  ATLAS_PUBLIC_URL: appUrl,
};

export default defineConfig({
  testDir: "./tests/acceptance",
  globalSetup: "./tests/acceptance/helpers/global-setup.ts",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: appUrl,
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: mailServerCommand,
      cwd: repoRoot,
      env: {
        ...baseWebServerEnv,
        MAIL_CAPTURE_FILE: mailboxFile,
      },
      reuseExistingServer: false,
      timeout: 30_000,
      url: new URL("/health", `${mailboxUrl}/`).toString(),
    },
    {
      command: "pnpm exec turbo run //#e2e:api --output-logs=errors-only",
      cwd: repoRoot,
      env: {
        ...baseWebServerEnv,
        ANTHROPIC_API_KEY: "e2e-test-key",
        ATLAS_AUTH_API_KEY_INTROSPECTION_URL: authIntrospectionUrl,
        ATLAS_AUTH_INTERNAL_SECRET: e2eInternalSecret,
        ATLAS_DEPLOY_MODE: "production",
        CORS_ORIGINS: `["${appUrl}"]`,
        DATABASE_URL: `sqlite:///${apiDbPath}`,
        ENVIRONMENT: "dev",
        LOG_LEVEL: "info",
        PORT: apiPort,
        SEARCH_API_KEY: "",
      },
      reuseExistingServer: false,
      timeout: 60_000,
      url: `${apiUrl}/health`,
    },
    {
      command: "pnpm --filter @rebuildingamerica/atlas-app dev:e2e",
      cwd: repoRoot,
      env: {
        ...baseWebServerEnv,
        ...commonAuthEnv,
        ATLAS_SERVER_API_PROXY_TARGET: apiUrl,
        NODE_ENV: "development",
        PORT: new URL(appUrl).port || "3100",
        ATLAS_AUTH_DB_PATH: authDbPath,
      },
      reuseExistingServer: false,
      timeout: 60_000,
      url: `${appUrl}/sign-in`,
    },
  ],
});
