import { describe, expect, it, vi } from "vitest";
import { currentWorkerRequest } from "../../../../../server/request-scope";

const calls = vi.hoisted(() => ({ dispatch: vi.fn(), render: vi.fn(), getRouter: vi.fn() }));
vi.mock("@/router", () => ({ getRouter: calls.getRouter }));
vi.mock("@/start", () => ({ startInstance: {} }));
vi.mock("@/domains/access/server/api-request-identity", () => ({}));
vi.mock("@/domains/access/server/auth-request-handler", () => ({
  dispatchAuthRequest: calls.dispatch,
}));
vi.mock("@tanstack/react-start/server-entry", () => ({ default: { fetch: calls.render } }));

describe("Worker session endpoint", () => {
  it("dispatches credentialed session reads inside the request scope without rendering a page", async () => {
    const { default: worker } = await import("../../../../../server/worker");
    const env = { HYPERDRIVE: { connectionString: "postgres://session" } } as Parameters<
      typeof worker.fetch
    >[1];
    calls.dispatch.mockImplementation((request: Request) => {
      expect(currentWorkerRequest()?.connectionString).toBe("postgres://session");
      expect(request.headers.get("cookie")).toBe("better-auth.session_token=signed");
      expect(request.headers.get("x-forwarded-for")).toBe("203.0.113.9");
      expect(request.headers.has("cf-access-client-secret")).toBe(false);
      const headers = new Headers();
      headers.append("set-cookie", "a=1; HttpOnly");
      headers.append("set-cookie", "b=2; HttpOnly");
      return Promise.resolve(Response.json({ user: { id: "one" } }, { headers }));
    });
    const response = await worker.fetch(
      new Request("https://atlas.test/api/auth/get-session", {
        headers: {
          cookie: "better-auth.session_token=signed",
          "cf-connecting-ip": "203.0.113.9",
          "x-forwarded-for": "forged",
          "cf-access-client-secret": "private",
        },
      }),
      env,
    );
    expect(await response.json()).toEqual({ user: { id: "one" } });
    expect(response.headers.getSetCookie()).toEqual(["a=1; HttpOnly", "b=2; HttpOnly"]);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(calls.dispatch).toHaveBeenCalledOnce();
    expect(calls.render).not.toHaveBeenCalled();
    expect(calls.getRouter).not.toHaveBeenCalled();
    expect(currentWorkerRequest()).toBeUndefined();
  });

  it("leaves other auth routes and methods with their existing handlers", async () => {
    const { default: worker } = await import("../../../../../server/worker");
    const env = { HYPERDRIVE: { connectionString: "postgres://session" } } as Parameters<
      typeof worker.fetch
    >[1];
    calls.render.mockImplementation(() => Promise.resolve(new Response("route")));
    for (const [path, method] of [
      ["/api/auth/internal/api-key", "GET"],
      ["/api/auth/get-session", "POST"],
      ["/api/auth/get-session/", "GET"],
    ] as const) {
      expect(
        await (
          await worker.fetch(new Request("https://atlas.test" + path, { method }), env)
        ).text(),
      ).toBe("route");
    }
    expect(calls.render).toHaveBeenCalledTimes(3);
    expect(calls.dispatch).not.toHaveBeenCalled();
  });
});

describe("Worker API binding", () => {
  it("routes MCP through the binding while docs and auth keep their own handlers", async () => {
    const { default: worker } = await import("../../../../../server/worker");
    const boundFetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe("https://api.example.com/mcp/?q=one");
      expect(request.headers.get("x-atlas-client-ip")).toBe("203.0.113.10");
      expect(request.headers.get("x-atlas-proxy-secret")).toBe("shared-secret");
      for (const name of [
        "cookie",
        "x-atlas-internal-secret",
        "x-atlas-actor-id",
        "x-atlas-organization-id",
      ])
        expect(request.headers.has(name)).toBe(false);
      expect(await request.text()).toBe("rpc-body");
      return new Response("bound", { status: 202 });
    });
    const env = {
      HYPERDRIVE: { connectionString: "postgres://session" },
      API_RUNTIME: { getByName: () => ({ fetch: boundFetch }) },
      ATLAS_API_ROUTE_PREFIX: "",
      ATLAS_SERVER_API_PROXY_TARGET: "https://api.example.com",
      ATLAS_AUTH_INTERNAL_SECRET: "shared-secret",
      ATLAS_DOCS_URL: "https://docs.example.com",
    } as unknown as Parameters<typeof worker.fetch>[1];
    const response = await worker.fetch(
      new Request("https://atlas.test/mcp?q=one", {
        method: "POST",
        body: "rpc-body",
        headers: {
          "cf-connecting-ip": "203.0.113.10",
          cookie: "session=private",
          "x-atlas-client-ip": "forged",
          "x-atlas-internal-secret": "forged",
          "x-atlas-actor-id": "forged",
          "x-atlas-organization-id": "forged",
        },
      }),
      env,
    );
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("bound");
    const network = vi.fn((request: Request) => {
      expect(request.url).toBe("https://docs.example.com/docs/guide");
      return Promise.resolve(new Response("docs"));
    });
    vi.stubGlobal("fetch", network);
    expect(
      await (await worker.fetch(new Request("https://atlas.test/docs/guide"), env)).text(),
    ).toBe("docs");
    calls.render.mockResolvedValue(new Response("auth"));
    expect(
      await (await worker.fetch(new Request("https://atlas.test/api/auth/sign-in"), env)).text(),
    ).toBe("auth");
    expect(boundFetch).toHaveBeenCalledOnce();
    expect(network).toHaveBeenCalledOnce();
  });
});

it("preserves the internal API introspection credential for the app-owned auth handler", async () => {
  const { default: worker } = await import("../../../../../server/worker");
  const env = { HYPERDRIVE: { connectionString: "postgres://session" } } as Parameters<
    typeof worker.fetch
  >[1];
  calls.render.mockImplementation((request: Request) => {
    expect(request.headers.get("x-atlas-internal-secret")).toBe("api-introspection-secret");
    return Promise.resolve(Response.json({ valid: true }));
  });
  const response = await worker.fetch(
    new Request("https://atlas.test/api/auth/internal/api-key", {
      method: "POST",
      headers: { "x-atlas-internal-secret": "api-introspection-secret" },
    }),
    env,
  );
  expect(await response.json()).toEqual({ valid: true });
});
