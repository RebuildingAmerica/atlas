import { describe, expect, it } from "vitest";
import { readAdminEnv } from "@/server/admin-env";
import {
  ADMIN_ORIGIN,
  API_ORIGIN,
  adminSource,
  TEST_OPERATOR,
  TEST_SIGNING_KEY,
} from "../helpers/admin-fixtures";

describe("admin settings", () => {
  it("reads a complete configuration", () => {
    const env = readAdminEnv(
      adminSource({
        ATLAS_PLATFORM_OPERATOR_EMAILS: ` ${TEST_OPERATOR.toUpperCase()} , ,other@example.test`,
      }),
      { development: false },
    );

    expect(env.adminOrigin).toBe(ADMIN_ORIGIN);
    expect(env.apiOrigin).toBe(API_ORIGIN);
    expect(env.devOperatorEmail).toBeNull();
    expect([...env.operators]).toEqual([TEST_OPERATOR, "other@example.test"]);
    expect(env.signingKey).toBe(TEST_SIGNING_KEY);
  });

  it.each([
    ["text that is not base64", "not base64!"],
    ["a key of the wrong length", btoa("too short")],
    ["a 48-byte value that is not an Ed25519 key", btoa("x".repeat(48))],
  ])("refuses a signing key that is %s", (_label, value) => {
    expect(() =>
      readAdminEnv(adminSource({ ATLAS_ADMIN_SIGNING_KEY: value }), {
        development: false,
      }),
    ).toThrow(
      "ATLAS_ADMIN_SIGNING_KEY must be a base64 PKCS#8 Ed25519 private key.",
    );
  });

  it.each([
    ["ATLAS_ADMIN_PUBLIC_URL", "ATLAS_ADMIN_PUBLIC_URL is required."],
    ["ATLAS_API_URL", "ATLAS_API_URL is required."],
    [
      "ATLAS_PLATFORM_OPERATOR_EMAILS",
      "ATLAS_PLATFORM_OPERATOR_EMAILS is required.",
    ],
    ["ATLAS_ADMIN_SIGNING_KEY", "ATLAS_ADMIN_SIGNING_KEY is required."],
    ["ATLAS_ACCESS_TEAM_DOMAIN", "ATLAS_ACCESS_TEAM_DOMAIN is required."],
  ] as const)("refuses to run without %s", (key, message) => {
    expect(() =>
      readAdminEnv(adminSource({ [key]: " " }), { development: false }),
    ).toThrow(message);
  });

  it("refuses an operator list that names no one", () => {
    expect(() =>
      readAdminEnv(adminSource({ ATLAS_PLATFORM_OPERATOR_EMAILS: " , " }), {
        development: false,
      }),
    ).toThrow("names no one");
  });

  it("refuses plain http outside local development", () => {
    expect(() =>
      readAdminEnv(adminSource({ ATLAS_API_URL: "http://localhost:8000" }), {
        development: false,
      }),
    ).toThrow("ATLAS_API_URL must use https.");
    expect(() =>
      readAdminEnv(adminSource({ ATLAS_API_URL: "http://api.example.test" }), {
        development: true,
      }),
    ).toThrow("ATLAS_API_URL must use https.");
  });

  it("allows a localhost API and a development operator under vite dev", () => {
    const env = readAdminEnv(
      adminSource({
        ATLAS_ADMIN_DEV_OPERATOR_EMAIL: " Dev@Example.test ",
        ATLAS_API_URL: "http://localhost:8000/",
      }),
      { development: true },
    );

    expect(env.apiOrigin).toBe("http://localhost:8000");
    expect(env.devOperatorEmail).toBe("dev@example.test");
  });

  it("refuses a development operator on a deployed admin", () => {
    expect(() =>
      readAdminEnv(
        adminSource({ ATLAS_ADMIN_DEV_OPERATOR_EMAIL: "dev@example.test" }),
        {
          development: false,
        },
      ),
    ).toThrow("must not be set on a deployed admin");
  });
});
