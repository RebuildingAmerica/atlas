import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  API_ORIGIN,
  makeRuntime,
  makeSigningKey,
  signedInRequest,
  TEST_OPERATOR,
} from "../helpers/admin-fixtures";
import { decodeSegment } from "../helpers/jwt";
import type { PlatformFetchState } from "../helpers/platform-fetch";

const state = vi.hoisted<PlatformFetchState>(() => ({
  request: new Request("https://atlas-admin.example.test/"),
  runtime: undefined,
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => state.request,
}));
vi.mock("@/server/admin-runtime", () => ({
  loadAdminRuntime: () => state.runtime,
}));

describe("the admin's private platform transport", () => {
  beforeEach(() => {
    state.runtime = undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("Public egress forbidden"))),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("delivers a mutation and both verified identities directly to the application object", async () => {
    const { platformFetch } = await import("@/server/platform-fetch");
    const { pkcs8, publicKey } = await makeSigningKey();
    const { runtime, keys } = await makeRuntime({}, pkcs8);
    state.request = await signedInRequest(keys);
    const delivered: Request[] = [];
    const names: string[] = [];
    state.runtime = {
      ...runtime,
      development: false,
      apiRuntime: {
        getByName(name, options) {
          names.push(name);
          expect(options).toEqual({ locationHint: "enam" });
          return {
            fetch(request) {
              delivered.push(request);
              return Promise.resolve(Response.json({ decision: "approved" }));
            },
          };
        },
      },
    };

    expect(
      await platformFetch(
        "/api/platform/discount-verifications/v-1?notify=true",
        {
          method: "POST",
          body: JSON.stringify({ decision: "approve" }),
          headers: {
            "content-type": "application/json",
            Authorization: "Bearer forged",
            "Cf-Access-Jwt-Assertion": "forged",
          },
        },
      ),
    ).toEqual({ decision: "approved" });
    expect(names).toEqual(["application"]);
    const request = delivered[0];
    expect(request?.url).toBe(
      `${API_ORIGIN}/api/platform/discount-verifications/v-1?notify=true`,
    );
    expect(request?.method).toBe("POST");
    expect(request?.redirect).toBe("manual");
    expect(await request?.json()).toEqual({ decision: "approve" });
    expect(request?.headers.get("Cf-Access-Jwt-Assertion")).toBe(
      state.request.headers.get("Cf-Access-Jwt-Assertion"),
    );
    expect(request?.headers.get("content-type")).toBe("application/json");
    expect(request?.headers.get("Accept")).toBe("application/json");
    const token =
      request?.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
    const [header = "", claims = "", signature = ""] = token.split(".");
    expect(decodeSegment(claims)).toMatchObject({
      act: TEST_OPERATOR,
      aud: "urn:atlas:platform-api",
      sub: "atlas-admin",
      iss: "https://atlas-admin.example.test",
    });
    expect(
      await crypto.subtle.verify(
        { name: "Ed25519" },
        publicKey,
        Buffer.from(signature, "base64url"),
        new TextEncoder().encode(`${header}.${claims}`),
      ),
    ).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses hosted API calls without a private binding", async () => {
    const { platformFetch } = await import("@/server/platform-fetch");
    const { runtime, keys } = await makeRuntime();
    state.runtime = { ...runtime, development: false };
    state.request = await signedInRequest(keys);
    await expect(
      platformFetch("/api/platform/cloud-costs"),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    "https://untrusted.example/api/platform/cloud-costs",
    "//untrusted.example/api/platform/cloud-costs",
    "/api/entities",
    "/api/platform-other/cloud-costs",
    "/api/platform/../auth/get-session",
    "/api/platform/%2e%2e%2fauth/get-session",
    "https://user:password@atlas-api.example.test/api/platform/cloud-costs",
    "https://:password@atlas-api.example.test/api/platform/cloud-costs",
  ])("refuses credentials leaving trusted platform routes: %s", async (url) => {
    const { platformFetch } = await import("@/server/platform-fetch");
    const { runtime, keys } = await makeRuntime();
    const call = vi.fn(() => ({ fetch: vi.fn() }));
    state.runtime = {
      ...runtime,
      development: false,
      apiRuntime: { getByName: call },
    };
    state.request = await signedInRequest(keys);
    await expect(platformFetch(url)).rejects.toMatchObject({ status: 403 });
    expect(call).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not deliver an unverified Access identity to the private API", async () => {
    const { platformFetch } = await import("@/server/platform-fetch");
    const { runtime } = await makeRuntime();
    const call = vi.fn(() => ({ fetch: vi.fn() }));
    state.runtime = {
      ...runtime,
      development: false,
      apiRuntime: { getByName: call },
    };
    state.request = new Request("https://atlas-admin.example.test/", {
      headers: { "Cf-Access-Jwt-Assertion": "forged" },
    });
    await expect(
      platformFetch("/api/platform/cloud-costs"),
    ).rejects.toMatchObject({ status: 403 });
    expect(call).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
