import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

import { defineConfig } from "@playwright/test";
import { buildAtlasAuthJwtAudiences } from "@rebuildingamerica/atlas-access/oauth-resource-config";

import { STORAGE_STATE } from "./tests/screenshots/capture-result";

function absoluteUrl(origin: string, pathname: string): string {
  return new URL(pathname, origin).toString().replace(/\/$/, "");
}

function envValue(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

const rawMode = process.env.ATLAS_SCREENSHOTS_MODE?.trim();
if (rawMode !== "local" && rawMode !== "session") {
  throw new Error('ATLAS_SCREENSHOTS_MODE must be either "local" or "session".');
}
const mode = rawMode;

const cacheDir = path.join(process.cwd(), "node_modules", ".cache", "screenshots");
mkdirSync(cacheDir, { recursive: true });
const repoRoot = path.join(process.cwd(), "..");

const apiDbPath = path.join(cacheDir, `atlas-api-${mode}.sqlite`);
const authDbPath = path.join(cacheDir, `atlas-auth-${mode}.sqlite`);
const mailboxFile = path.join(cacheDir, `mailbox-${mode}.json`);

// The databases are cleared by scripts/screenshots/run.ts before each pass. It must not happen
// here: Playwright re-evaluates this config in every worker process, so wiping here deletes the
// database out from under the running API mid-run.

// Ports are distinct from dev (3000) and the acceptance suite (3100) so an audit can run while
// either of those is up, and distinct per mode so the second pass never races the first pass's
// teardown -- turbo orphans the API process it spawns, which would otherwise leave the session
// pass talking to the local pass's database.
const portOffset = mode === "session" ? 1 : 0;
const appUrl = envValue("ATLAS_SCREENSHOTS_APP_URL", `http://localhost:${3200 + portOffset}`);
const apiUrl = envValue("ATLAS_SCREENSHOTS_API_URL", `http://localhost:${38200 + portOffset}`);
const mailboxUrl = envValue(
  "ATLAS_SCREENSHOTS_MAILBOX_URL",
  `http://localhost:${8225 + portOffset}`,
);

// `tests/acceptance/helpers/auth.ts` reads this at module load and throws when it is unset,
// so it has to be assigned before Playwright imports the setup project.
process.env.ATLAS_E2E_MAILBOX_URL = mailboxUrl;

const apiPort = new URL(apiUrl).port;
if (!apiPort) {
  throw new Error("ATLAS_SCREENSHOTS_API_URL must include an explicit port.");
}
const appPort = new URL(appUrl).port;
const mailboxPort = new URL(mailboxUrl).port;

const deployMode = mode === "local" ? "local" : "production";
const authIntrospectionUrl = absoluteUrl(appUrl, "/api/auth/internal/api-key");
const authJwtAudiences = buildAtlasAuthJwtAudiences({
  apiBaseUrl: apiUrl,
  publicBaseUrl: appUrl,
});
// Deterministic so a run is reproducible. This is a localhost-only harness credential.
const internalSecret = createHash("sha256").update("atlas-screenshots-harness").digest("hex");
const operatorAllowedEmails = "person@atlas.test";

delete process.env.NO_COLOR;
delete process.env.FORCE_COLOR;
const baseWebServerEnv = { ...process.env };
delete baseWebServerEnv.NO_COLOR;
delete baseWebServerEnv.FORCE_COLOR;

const mailWebServer = {
  command: "pnpm --filter @rebuildingamerica/atlas-app e2e:mail:ci",
  cwd: repoRoot,
  env: { ...baseWebServerEnv, MAIL_CAPTURE_FILE: mailboxFile, PORT: mailboxPort },
  reuseExistingServer: false,
  timeout: 30_000,
  url: new URL("/health", `${mailboxUrl}/`).toString(),
};

const apiWebServer = {
  command: "pnpm exec turbo run //#screenshots:api --output-logs=full",
  cwd: repoRoot,
  env: {
    ...baseWebServerEnv,
    ANTHROPIC_API_KEY: "screenshots-test-key",
    ATLAS_ANON_RATE_LIMIT_ENABLED: "false",
    ATLAS_AUTH_API_KEY_INTROSPECTION_URL: authIntrospectionUrl,
    ATLAS_AUTH_INTERNAL_SECRET: internalSecret,
    ATLAS_AUTH_JWT_AUDIENCES: authJwtAudiences,
    ATLAS_AUTH_MEMBERSHIP_URL: appUrl,
    ATLAS_DEPLOY_MODE: deployMode,
    ATLAS_OPERATOR_ALLOWED_EMAILS: operatorAllowedEmails,
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
  stderr: "pipe" as const,
  stdout: "pipe" as const,
  timeout: 180_000,
  url: absoluteUrl(apiUrl, "/health"),
};

const appWebServer = {
  command: "pnpm exec turbo run @rebuildingamerica/atlas-app#start:e2e --output-logs=full",
  cwd: repoRoot,
  env: {
    ...baseWebServerEnv,
    ATLAS_ANON_RATE_LIMIT_ENABLED: "false",
    ATLAS_AUTH_API_KEY_INTROSPECTION_URL: authIntrospectionUrl,
    ATLAS_AUTH_BASE_PATH: "/api/auth",
    ATLAS_AUTH_DB_PATH: authDbPath,
    ATLAS_AUTH_INTERNAL_SECRET: internalSecret,
    ATLAS_AUTH_JWT_AUDIENCES: authJwtAudiences,
    ATLAS_AUTH_MEMBERSHIP_URL: appUrl,
    ATLAS_DEPLOY_MODE: deployMode,
    ATLAS_EMAIL_CAPTURE_URL: `${mailboxUrl}/messages`,
    ATLAS_EMAIL_FROM: "Atlas <hello@localhost>",
    ATLAS_EMAIL_PROVIDER: "capture",
    ATLAS_OPERATOR_ALLOWED_EMAILS: operatorAllowedEmails,
    ATLAS_PUBLIC_URL: appUrl,
    ATLAS_SERVER_API_PROXY_TARGET: apiUrl,
    NODE_ENV: "development",
    PORT: appPort,
  },
  reuseExistingServer: false,
  stderr: "pipe" as const,
  stdout: "pipe" as const,
  timeout: 240_000,
  url: absoluteUrl(appUrl, "/browse"),
};

const sessionProjects = [
  { name: "setup", testMatch: /auth\.setup\.ts/ },
  {
    dependencies: ["setup"],
    name: "capture",
    testMatch: /capture\.screenshots\.ts/,
    use: { storageState: STORAGE_STATE },
  },
];

const localProjects = [{ name: "capture", testMatch: /capture\.screenshots\.ts/ }];

export default defineConfig({
  fullyParallel: true,
  projects: mode === "session" ? sessionProjects : localProjects,
  reporter: [["list"]],
  retries: 0,
  testDir: "./tests/screenshots",
  timeout: 120_000,
  use: {
    baseURL: appUrl,
    colorScheme: "light",
    deviceScaleFactor: 1,
    headless: true,
    trace: "retain-on-failure",
    viewport: { height: 900, width: 1440 },
  },
  // Session mode shares one signed-in storage state, so keep concurrency modest there.
  workers: mode === "session" ? 2 : 4,
  webServer:
    mode === "session" ? [mailWebServer, apiWebServer, appWebServer] : [apiWebServer, appWebServer],
});
