import { existsSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { defineConfig } from "@playwright/test";
import { buildAtlasAuthJwtAudiences } from "./src/domains/access/oauth-resource-config";

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

function absoluteUrl(origin: string, pathname: string): string {
  return new URL(pathname, origin).toString().replace(/\/$/, "");
}

const e2eDir = path.join(process.cwd(), "node_modules", ".cache", "e2e");
mkdirSync(e2eDir, { recursive: true });
const repoRoot = path.join(process.cwd(), "..");
const e2eRunId = process.env.ATLAS_E2E_RUN_ID?.trim() || randomBytes(8).toString("hex");
const apiDbPath = path.join(e2eDir, `atlas-api-${e2eRunId}.sqlite`);
const authDbPath = path.join(e2eDir, `atlas-auth-${e2eRunId}.sqlite`);
const mailboxFile = path.join(e2eDir, `mailbox-${e2eRunId}.json`);
const appUrl = requireEnv("ATLAS_E2E_APP_URL");
const apiUrl = requireEnv("ATLAS_E2E_API_URL");
const authJwtAudiences = buildAtlasAuthJwtAudiences({
  apiBaseUrl: apiUrl,
  publicBaseUrl: appUrl,
});
const mailboxUrl = requireEnv("ATLAS_E2E_MAILBOX_URL");
const authIntrospectionUrl = requireEnv("ATLAS_E2E_AUTH_INTROSPECTION_URL");
const appPort = new URL(appUrl).port || "3100";
const apiPort = new URL(apiUrl).port;
const mailboxPort = new URL(mailboxUrl).port || "8025";
const workerCount = Number.parseInt(process.env.ATLAS_E2E_WORKERS || "4", 10);
if (!Number.isInteger(workerCount) || workerCount < 1) {
  throw new Error("ATLAS_E2E_WORKERS must be a positive integer.");
}
if (!apiPort) {
  throw new Error("ATLAS_E2E_API_URL must include an explicit port.");
}
const e2eInternalSecret =
  process.env.ATLAS_E2E_INTERNAL_SECRET?.trim() || randomBytes(32).toString("hex");
const baseWebServerEnv = { ...process.env };
delete baseWebServerEnv.NO_COLOR;
delete baseWebServerEnv.FORCE_COLOR;
// The app posts directly to ATLAS_EMAIL_CAPTURE_URL, so the mail capture server
// only needs to listen on localhost. Avoiding the portless DNS shim keeps local
// acceptance startup deterministic.
const mailServerCommand = "pnpm --filter @rebuildingamerica/atlas-app e2e:mail:ci";
const commonAuthEnv = {
  ATLAS_AUTH_ALLOWED_EMAILS: "person@atlas.test",
  ATLAS_AUTH_API_KEY_INTROSPECTION_URL: authIntrospectionUrl,
  ATLAS_AUTH_BASE_PATH: "/api/auth",
  ATLAS_AUTH_INTERNAL_SECRET: e2eInternalSecret,
  ATLAS_AUTH_MEMBERSHIP_URL: appUrl,
  ATLAS_AUTH_JWT_AUDIENCES: authJwtAudiences,
  ATLAS_DEPLOY_MODE: "production",
  ATLAS_EMAIL_CAPTURE_URL: `${mailboxUrl}/messages`,
  ATLAS_EMAIL_FROM: "Atlas <hello@localhost>",
  ATLAS_EMAIL_PROVIDER: "capture",
  ATLAS_PUBLIC_URL: appUrl,
};

export default defineConfig({
  testDir: "./tests/acceptance",
  globalSetup: "./tests/acceptance/helpers/global-setup.ts",
  timeout: 60_000,
  fullyParallel: true,
  workers: workerCount,
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
        PORT: mailboxPort,
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
        ATLAS_AUTH_MEMBERSHIP_URL: appUrl,
        ATLAS_AUTH_JWT_AUDIENCES: authJwtAudiences,
        ATLAS_DEPLOY_MODE: "production",
        ATLAS_PUBLIC_URL: appUrl,
        CORS_ORIGINS: `["${appUrl}"]`,
        DATABASE_URL: `sqlite:///${apiDbPath}`,
        DISCOVERY_JOB_WORKER_ENABLED: "false",
        ENVIRONMENT: "dev",
        LOG_LEVEL: "info",
        PORT: apiPort,
        SEARCH_API_KEY: "",
      },
      reuseExistingServer: false,
      timeout: 120_000,
      url: absoluteUrl(apiUrl, "/health"),
    },
    {
      command: `pnpm --filter @rebuildingamerica/atlas-app exec vite dev --host 127.0.0.1 --port ${appPort} --strictPort`,
      cwd: repoRoot,
      env: {
        ...baseWebServerEnv,
        ...commonAuthEnv,
        ATLAS_SERVER_API_PROXY_TARGET: apiUrl,
        NODE_ENV: "development",
        PORT: appPort,
        ATLAS_AUTH_DB_PATH: authDbPath,
      },
      reuseExistingServer: false,
      timeout: 180_000,
      url: absoluteUrl(appUrl, "/sign-in"),
    },
  ],
});
