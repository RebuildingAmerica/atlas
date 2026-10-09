import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_ORIGIN, TEST_OPERATOR } from "../helpers/admin-fixtures";
import {
  signInOperator,
  stubFetch,
  type PlatformFetchState,
} from "../helpers/platform-fetch";

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

describe("calling the platform API", () => {
  beforeEach(() => {
    state.runtime = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("signs the call as the admin and forwards the operator's Access sign-in", async () => {
    const { platformFetch } = await import("@/server/platform-fetch");
    await signInOperator(state);
    const fetchMock = stubFetch(Response.json({ total: 0 }));

    const body = await platformFetch("/api/platform/discount-verifications", {
      method: "GET",
    });

    expect(body).toEqual({ total: 0 });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toEqual(
      new URL(`${API_ORIGIN}/api/platform/discount-verifications`),
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toMatch(
      /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/,
    );
    expect(headers.get("Cf-Access-Jwt-Assertion")).toBe(
      state.request.headers.get("Cf-Access-Jwt-Assertion"),
    );
    expect(headers.get("Accept")).toBe("application/json");
    expect(init?.method).toBe("GET");
  });

  it("forwards no Access assertion when developing as a local operator", async () => {
    const { platformFetch } = await import("@/server/platform-fetch");
    const runtime = await signInOperator(state);
    state.runtime = {
      ...runtime,
      env: { ...runtime.env, devOperatorEmail: TEST_OPERATOR },
    };
    state.request = new Request("http://localhost:3200/");
    const fetchMock = stubFetch(new Response(null, { status: 204 }));

    expect(await platformFetch("/api/platform/cloud-costs")).toBeUndefined();
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has(
        "Cf-Access-Jwt-Assertion",
      ),
    ).toBe(false);
  });

  it("refuses when the admin is not configured", async () => {
    const { PlatformApiError, platformFetch } =
      await import("@/server/platform-fetch");
    state.runtime = new Error("ATLAS_API_URL is required.");

    await expect(platformFetch("/api/platform/cloud-costs")).rejects.toEqual(
      new PlatformApiError(503, "The Atlas platform admin is not configured."),
    );
  });

  it("asks the operator to sign in again when the Access sign-in no longer holds", async () => {
    const { platformFetch } = await import("@/server/platform-fetch");
    await signInOperator(state);
    state.request = new Request("https://atlas-admin.example.test/");

    await expect(
      platformFetch("/api/platform/cloud-costs"),
    ).rejects.toMatchObject({
      message: "Sign in again through Cloudflare Access.",
      status: 403,
    });
  });

  it("shows the API's own explanation when it refuses", async () => {
    const { platformFetch } = await import("@/server/platform-fetch");
    await signInOperator(state);
    stubFetch(
      Response.json(
        {
          detail:
            "The applicant could not be emailed, so the request is still waiting. Decide it again.",
        },
        { status: 502 },
      ),
    );

    await expect(
      platformFetch("/api/platform/discount-verifications/v-1"),
    ).rejects.toMatchObject({
      message:
        "The applicant could not be emailed, so the request is still waiting. Decide it again.",
      name: "PlatformApiError",
      status: 502,
    });
  });

  it.each([
    ["an empty body", new Response("", { status: 500 })],
    [
      "a body that is not JSON",
      new Response("<html>bad gateway</html>", { status: 502 }),
    ],
    [
      "JSON without a detail",
      Response.json({ detail: { code: 1 } }, { status: 500 }),
    ],
  ])("names the status when the API answers %s", async (_label, response) => {
    const { platformFetch } = await import("@/server/platform-fetch");
    await signInOperator(state);
    stubFetch(response);

    await expect(
      platformFetch("/api/platform/cloud-costs"),
    ).rejects.toMatchObject({
      message: `The Atlas API answered ${String(response.status)}.`,
    });
  });

  it("refuses a successful answer that is not JSON instead of showing it as empty", async () => {
    const { platformFetch } = await import("@/server/platform-fetch");
    await signInOperator(state);
    stubFetch(new Response("<html>sign in</html>", { status: 200 }));

    await expect(
      platformFetch("/api/platform/cloud-costs"),
    ).rejects.toMatchObject({
      message: "The Atlas API answered with something other than JSON.",
      name: "PlatformApiError",
      status: 200,
    });
  });
});
