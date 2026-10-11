import { describe, expect, it } from "vitest";
import config from "../../cloudflare.config";
import {
  ADMIN_DEVELOPMENT_SETTINGS,
  ADMIN_SETTINGS,
  adminHostname,
  adminWorkerConfig,
} from "@/platform/worker-config";
import { ADMIN_PUBLIC_URL as PUBLIC_URL } from "../fixtures/admin";

describe("the admin Worker's deployment settings", () => {
  it("publishes only to the admin's own hostname, with no other way in", () => {
    const worker = adminWorkerConfig(
      {
        ATLAS_ADMIN_PUBLIC_URL: PUBLIC_URL,
        ATLAS_ADMIN_DEPLOY_ENVIRONMENT: "production",
      },
      { mode: "production" },
    );

    expect(worker).toMatchObject({
      name: "atlas-admin",
      compatibilityFlags: ["nodejs_compat"],
      workersDev: false,
      previewUrls: false,
      domains: ["atlas-admin.rebuildingus.org"],
      assets: { runWorkerFirst: ["/*", "!/assets/*"] },
      observability: { enabled: true, logs: { invocationLogs: false } },
    });
    expect(Object.keys(worker.env)).toEqual([...ADMIN_SETTINGS]);
    expect(
      Object.values(worker.env).every((binding) => binding.type === "secret"),
    ).toBe(true);
  });

  it("isolates staging code, secrets and hostname from production", () => {
    const worker = adminWorkerConfig(
      {
        ATLAS_ADMIN_PUBLIC_URL: "https://atlas-admin-staging.rebuildingus.org",
        ATLAS_ADMIN_DEPLOY_ENVIRONMENT: "staging",
      },
      { mode: "production" },
    );
    expect(worker.name).toBe("atlas-admin-staging");
    expect(worker.domains).toEqual(["atlas-admin-staging.rebuildingus.org"]);
  });

  it.each([undefined, "preview"])(
    "refuses an undefined deployment target %s",
    (target) => {
      expect(() =>
        adminWorkerConfig(
          {
            ATLAS_ADMIN_PUBLIC_URL: PUBLIC_URL,
            ATLAS_ADMIN_DEPLOY_ENVIRONMENT: target,
          },
          { mode: "production" },
        ),
      ).toThrow("ATLAS_ADMIN_DEPLOY_ENVIRONMENT must be production or staging");
    },
  );

  it.each([
    ["staging", PUBLIC_URL],
    ["production", "https://atlas-admin-staging.rebuildingus.org"],
    ["staging", "https://unrelated.example.org"],
  ])("refuses target %s taking over hostname %s", (target, publicUrl) => {
    expect(() =>
      adminWorkerConfig(
        {
          ATLAS_ADMIN_PUBLIC_URL: publicUrl,
          ATLAS_ADMIN_DEPLOY_ENVIRONMENT: target,
        },
        { mode: "production" },
      ),
    ).toThrow("does not match the");
  });

  it("has no hostname in development and allows the development operator there only", () => {
    const worker = adminWorkerConfig({}, { mode: "development" });

    expect(worker.domains).toEqual([]);
    expect(Object.keys(worker.env)).toEqual([
      ...ADMIN_SETTINGS,
      ...ADMIN_DEVELOPMENT_SETTINGS,
    ]);
  });

  it.each([
    [undefined, "ATLAS_ADMIN_PUBLIC_URL is required"],
    ["  ", "ATLAS_ADMIN_PUBLIC_URL is required"],
    ["http://atlas-admin.rebuildingus.org", "https origin with no path"],
    ["https://atlas-admin.rebuildingus.org/admin", "https origin with no path"],
  ])("refuses to build with ATLAS_ADMIN_PUBLIC_URL=%s", (value, message) => {
    expect(() => adminHostname(value)).toThrow(message);
  });

  it("accepts an origin written with a trailing slash", () => {
    expect(adminHostname(`${PUBLIC_URL}/`)).toBe(
      "atlas-admin.rebuildingus.org",
    );
  });

  it("is what cloudflare.config.ts hands to cf", () => {
    const worker = config.worker as (context: {
      mode: string | undefined;
    }) => unknown;

    expect(worker({ mode: "development" })).toEqual(
      adminWorkerConfig({}, { mode: "development" }),
    );
  });
});
