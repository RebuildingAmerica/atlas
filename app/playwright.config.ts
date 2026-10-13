import { mkdirSync } from "node:fs";
import { createHash, randomBytes, generateKeyPairSync, sign } from "node:crypto";
import path from "node:path";
import { defineConfig } from "@playwright/test";
import { buildAtlasAuthJwtAudiences } from "@rebuildingamerica/atlas-access/oauth-resource-config";

function absoluteUrl(origin: string, pathname: string): string {
  return new URL(pathname, origin).toString().replace(/\/$/, "");
}

function envValue(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function setDefaultEnv(name: string, value: string): void {
  if (!process.env[name]?.trim()) {
    process.env[name] = value;
  }
}

const e2eDir = path.join(process.cwd(), "node_modules", ".cache", "e2e");
mkdirSync(e2eDir, { recursive: true });
const repoRoot = path.join(process.cwd(), "..");
const e2eRunId = process.env.ATLAS_E2E_RUN_ID?.trim() || randomBytes(8).toString("hex");
setDefaultEnv("ATLAS_E2E_RUN_ID", e2eRunId);
const apiDbPath = path.join(e2eDir, `atlas-api-${e2eRunId}.sqlite`);
const authDbPath = path.join(e2eDir, `atlas-auth-${e2eRunId}.sqlite`);
const mailboxFile = path.join(e2eDir, `mailbox-${e2eRunId}.json`);
const appUrl = envValue("ATLAS_E2E_APP_URL", "http://localhost:3100");
const apiUrl = envValue("ATLAS_E2E_API_URL", "http://localhost:38000");
const authJwtAudiences = buildAtlasAuthJwtAudiences({
  apiBaseUrl: apiUrl,
  publicBaseUrl: appUrl,
});
const mailboxUrl = envValue("ATLAS_E2E_MAILBOX_URL", "http://localhost:8025");
const authIntrospectionUrl = envValue(
  "ATLAS_E2E_AUTH_INTROSPECTION_URL",
  absoluteUrl(appUrl, "/api/auth/internal/api-key"),
);
setDefaultEnv("ATLAS_E2E_APP_URL", appUrl);
setDefaultEnv("ATLAS_E2E_API_URL", apiUrl);
setDefaultEnv("ATLAS_E2E_MAILBOX_URL", mailboxUrl);
setDefaultEnv("ATLAS_E2E_AUTH_INTROSPECTION_URL", authIntrospectionUrl);
const appPort = new URL(appUrl).port || "3100";
const apiPort = new URL(apiUrl).port;
const mailboxPort = new URL(mailboxUrl).port || "8025";
const workerCount = Number.parseInt(process.env.ATLAS_E2E_WORKERS || "4", 10);
if (!Number.isInteger(workerCount) || workerCount < 1) {
  throw new Error("ATLAS_E2E_WORKERS must be a positive integer.");
}
const slowMoMs = Number.parseInt(process.env.ATLAS_E2E_SLOW_MO_MS || "0", 10);
if (!Number.isInteger(slowMoMs) || slowMoMs < 0) {
  throw new Error("ATLAS_E2E_SLOW_MO_MS must be a non-negative integer.");
}
const videoMode = process.env.ATLAS_E2E_VIDEO === "1";
if (!apiPort) {
  throw new Error("ATLAS_E2E_API_URL must include an explicit port.");
}
const e2eInternalSecret =
  process.env.ATLAS_E2E_INTERNAL_SECRET?.trim() ||
  createHash("sha256").update(`atlas-e2e:${e2eRunId}`).digest("hex");
setDefaultEnv("ATLAS_E2E_INTERNAL_SECRET", e2eInternalSecret);
// Each secret the app and API share gets its own value, as in a hosted
// deployment, so a test cannot pass by accident because two of them match.
const e2eCallbackSecret = createHash("sha256")
  .update(`atlas-e2e-callback:${e2eRunId}`)
  .digest("hex");
const e2eEdgeOriginSecret = createHash("sha256")
  .update(`atlas-e2e-edge-origin:${e2eRunId}`)
  .digest("hex");
delete process.env.NO_COLOR;
delete process.env.FORCE_COLOR;
const baseWebServerEnv = { ...process.env };
delete baseWebServerEnv.NO_COLOR;
delete baseWebServerEnv.FORCE_COLOR;
// The app posts directly to ATLAS_EMAIL_CAPTURE_URL, so the mail capture server
// only needs to listen on localhost. Avoiding the portless DNS shim keeps local
// acceptance startup deterministic.
const mailServerCommand = "pnpm --filter @rebuildingamerica/atlas-app e2e:mail:ci";
const instanceOperatorEmails = "person@atlas.test";
// The paid-waitlist journey runs the real admin -> signed API -> app callback
// chain. Only test-owned entrypoints substitute this run's local Access keys.
const platformWaitlist = process.env.ATLAS_PAID_ACCESS_MODE === "waitlist";
const adminUrl = envValue("ATLAS_E2E_ADMIN_URL", "http://localhost:3200");
setDefaultEnv("ATLAS_E2E_ADMIN_URL", adminUrl);
const adminKeys = generateKeyPairSync("ed25519");
const accessKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const accessAud = "ab".repeat(32);
const accessTeam = "atlas-e2e.cloudflareaccess.com";
const operatorEmail = "platform@atlas.test";
const accessJwk = {
  ...accessKeys.publicKey.export({ format: "jwk" }),
  kid: "e2e-access",
  alg: "RS256",
};
const encode = (input: object) => Buffer.from(JSON.stringify(input)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const accessPayload = `${encode({ alg: "RS256", kid: "e2e-access" })}.${encode({ iss: `https://${accessTeam}`, aud: [accessAud], sub: "e2e-platform-operator", email: operatorEmail, iat: now, nbf: now, exp: now + 3600 })}`;
setDefaultEnv(
  "ATLAS_E2E_ACCESS_ASSERTION",
  `${accessPayload}.${sign("RSA-SHA256", Buffer.from(accessPayload), accessKeys.privateKey).toString("base64url")}`,
);
const platformEnv = {
  ATLAS_E2E_ACCESS_JWKS: JSON.stringify({ keys: [accessJwk] }),
  ATLAS_ACCESS_TEAM_DOMAIN: accessTeam,
  ATLAS_ACCESS_AUD: accessAud,
  ATLAS_PLATFORM_OPERATOR_EMAILS: operatorEmail,
  ATLAS_ADMIN_PUBLIC_URL: adminUrl,
  ATLAS_API_URL: apiUrl,
  ATLAS_ADMIN_SIGNING_KEY: adminKeys.privateKey
    .export({ format: "der", type: "pkcs8" })
    .toString("base64"),
  ATLAS_MACHINE_TRUSTED_ISSUERS: JSON.stringify([
    {
      kind: "ed25519_jwt",
      name: "atlas-admin",
      issuer: adminUrl,
      audience: "urn:atlas:platform-api",
      public_key: Buffer.from(
        adminKeys.publicKey.export({ format: "jwk" }).x ?? "",
        "base64url",
      ).toString("base64"),
      actions: ["platform.waitlist.read", "platform.waitlist.write"],
    },
  ]),
};
const commonAuthEnv = {
  ATLAS_INSTANCE_OPERATOR_EMAILS: instanceOperatorEmails,
  ATLAS_AUTH_API_KEY_INTROSPECTION_URL: authIntrospectionUrl,
  ATLAS_AUTH_BASE_PATH: "/api/auth",
  ATLAS_AUTH_INTERNAL_SECRET: e2eInternalSecret,
  ATLAS_AUTH_CALLBACK_SECRET: e2eCallbackSecret,
  ATLAS_AUTH_MEMBERSHIP_URL: appUrl,
  ATLAS_AUTH_JWT_AUDIENCES: authJwtAudiences,
  ATLAS_ANON_RATE_LIMIT_ENABLED: "false",
  ATLAS_EDGE_ORIGIN_SECRET: e2eEdgeOriginSecret,
  ATLAS_MANAGED: "true",
  ATLAS_PAID_ACCESS_MODE: envValue("ATLAS_PAID_ACCESS_MODE", "open"),
  ATLAS_MULTI_USER: "true",
  ATLAS_E2E_WORKSPACE_SEED_ENABLED: "1",
  ATLAS_E2E_INTERNAL_SECRET: e2eInternalSecret,
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
    launchOptions: slowMoMs > 0 ? { slowMo: slowMoMs } : undefined,
    trace: "retain-on-failure",
    video: videoMode ? "on" : "off",
  },
  webServer: [
    ...(platformWaitlist
      ? [
          {
            command: `pnpm --dir admin exec vite dev --config vite.waitlist-e2e.config.ts --port ${new URL(adminUrl).port} --strictPort`,
            cwd: repoRoot,
            env: { ...baseWebServerEnv, ...platformEnv },
            reuseExistingServer: false,
            timeout: 120_000,
            // Every page is Access-protected. Vite's client resource is a readiness
            // probe; the browser journey itself proves the authenticated page.
            url: new URL("/@vite/client", adminUrl).toString(),
          },
        ]
      : []),
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
      command: platformWaitlist
        ? `uv --directory api run python -m atlas.seed_profiles --database-url 'sqlite:///${apiDbPath.replaceAll("'", "'\\''")}' && uv --directory api run python tests/support/platform_e2e_server.py`
        : "pnpm exec turbo run //#e2e:api --output-logs=full",
      cwd: repoRoot,
      env: {
        ...baseWebServerEnv,
        ...(platformWaitlist ? platformEnv : {}),
        ANTHROPIC_API_KEY: "e2e-test-key",
        ATLAS_AUTH_API_KEY_INTROSPECTION_URL: authIntrospectionUrl,
        ATLAS_AUTH_CALLBACK_SECRET: e2eCallbackSecret,
        ATLAS_AUTH_MEMBERSHIP_URL: appUrl,
        ATLAS_AUTH_JWT_AUDIENCES: authJwtAudiences,
        ATLAS_ANON_RATE_LIMIT_ENABLED: "false",
        ATLAS_EDGE_ORIGIN_SECRET: e2eEdgeOriginSecret,
        ATLAS_E2E_INTERNAL_SECRET: e2eInternalSecret,
        ATLAS_MANAGED: "true",
        ATLAS_MULTI_USER: "true",
        ATLAS_INSTANCE_OPERATOR_EMAILS: instanceOperatorEmails,
        ATLAS_PUBLIC_URL: appUrl,
        CORS_ORIGINS: `["${appUrl}"]`,
        DATABASE_URL: `sqlite:///${apiDbPath}`,
        DISCOVERY_JOB_WORKER_ENABLED: "false",
        ENVIRONMENT: "staging",
        LOG_LEVEL: "info",
        PORT: apiPort,
        SEARCH_API_KEY: "",
      },
      reuseExistingServer: false,
      timeout: 120_000,
      url: absoluteUrl(apiUrl, "/health"),
    },
    {
      command: platformWaitlist
        ? "node app/.output/server/index.mjs"
        : "pnpm exec turbo run @rebuildingamerica/atlas-app#start:e2e --output-logs=full",
      cwd: repoRoot,
      env: {
        ...baseWebServerEnv,
        ...commonAuthEnv,
        ATLAS_SERVER_API_PROXY_TARGET: apiUrl,
        // The acceptance run has to be able to buy. The e2e API seeds
        // profiles before it boots, so the catalog probe finds entries.
        ATLAS_BILLING_CHECKOUT_ENABLED: "true",
        // The built server uses production billing guards, which require an
        // explicit offer allowlist even when the test process is local.
        ATLAS_BILLING_ALLOWED_OFFERS:
          "atlas_pro:monthly,atlas_pro:yearly,atlas_pro:four_month,atlas_team:monthly,atlas_team:yearly,atlas_research_pass:weekly,atlas_research_pass:once",
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
