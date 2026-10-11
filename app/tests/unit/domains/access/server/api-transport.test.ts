import { afterEach, expect, it, vi } from "vitest";
import {
  atlasFetch,
  setServerApiTransportProvider,
} from "@rebuildingamerica/atlas-api-client/orval/fetcher";
import { createWorkerApiTransport } from "../../../../../server/api-transport";
import { currentWorkerRequest, runWorkerRequest } from "../../../../../server/request-scope";

afterEach(() => {
  setServerApiTransportProvider(undefined);
});

it("forwards the exact API method, query and body with trusted visitor headers", async () => {
  const fetch = vi.fn(async (request: Request) => {
    expect(request.url).toBe("https://api.example.com/api/entities?q=a%2Fb");
    expect(request.method).toBe("PATCH");
    expect(await request.text()).toBe("payload");
    expect(request.headers.get("authorization")).toBe("Bearer visitor");
    expect(request.headers.get("x-atlas-client-ip")).toBe("203.0.113.8");
    expect(request.headers.get("x-atlas-proxy-secret")).toBe("trusted-secret");
    for (const name of [
      "cookie",
      "host",
      "x-forwarded-for",
      "cf-access-client-secret",
      "x-untrusted-hop",
    ])
      expect(request.headers.has(name)).toBe(false);
    expect(request.redirect).toBe("manual");
    return new Response("upstream", { status: 207, headers: { "x-result": "retained" } });
  });
  const getByName = vi.fn(() => ({ fetch }));
  const transport = createWorkerApiTransport(
    { getByName },
    "https://api.example.com",
    "203.0.113.8",
    "trusted-secret",
    "",
  );
  const response = await transport(
    new Request("https://api.example.com/api/entities?q=a%2Fb", {
      method: "PATCH",
      body: "payload",
      headers: {
        cookie: "session=private",
        host: "forged",
        authorization: "Bearer visitor",
        "x-forwarded-for": "forged",
        "x-atlas-client-ip": "forged",
        "x-atlas-proxy-secret": "forged",
        "cf-access-client-secret": "private",
        connection: "x-untrusted-hop",
        "x-untrusted-hop": "bad",
      },
    }),
  );
  expect(getByName).toHaveBeenCalledWith("application", { locationHint: "enam" });
  expect(response?.status).toBe(207);
  expect(response?.headers.get("x-result")).toBe("retained");
  expect(await response?.text()).toBe("upstream");
});

it("declines unrelated origins and app-owned routes before reaching the binding", async () => {
  const getByName = vi.fn(() => ({ fetch: vi.fn() }));
  const transport = createWorkerApiTransport(
    { getByName },
    "https://api.example.com",
    null,
    "secret",
    "",
  );
  for (const url of [
    "https://outside.example.com/api/entities",
    "https://api.example.com/docs",
    "https://api.example.com/api/auth/get-session",
    "https://api.example.com/api/stripe/webhook",
    "https://api.example.com/api/e2e/hosted/identity",
    "https://api.example.com/api/atproto/oauth/start",
  ])
    expect(await transport(new Request(url))).toBeUndefined();
  expect(getByName).not.toHaveBeenCalled();
});

it("keeps concurrent SSR calls and stream cancellation inside their request transport", async () => {
  vi.stubGlobal("window", undefined);
  vi.stubEnv("ATLAS_SERVER_API_PROXY_TARGET", "https://api.example.com");
  setServerApiTransportProvider(() => currentWorkerRequest()?.apiTransport);
  const cancelled: string[] = [];
  const render = (visitor: string) => {
    const transport = createWorkerApiTransport(
      {
        getByName: () => ({
          fetch: async (request: Request) => {
            await new Promise((resolve) => setTimeout(resolve, 1));
            return Response.json({ visitor: request.headers.get("x-atlas-client-ip") });
          },
        }),
      },
      "https://api.example.com",
      visitor,
      "secret",
      "",
    );
    return runWorkerRequest(
      "postgres://" + visitor,
      async () => {
        const data = await atlasFetch<{ visitor: string }>("/api/entities");
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(data.visitor));
            },
            cancel() {
              cancelled.push(visitor);
            },
          }),
        );
      },
      { apiTransport: transport },
    );
  };
  const [first, second] = await Promise.all([render("203.0.113.1"), render("203.0.113.2")]);
  if (!first.body || !second.body) throw new Error("Missing response body");
  const one = first.body.getReader(),
    two = second.body.getReader();
  expect(new TextDecoder().decode((await one.read()).value)).toBe("203.0.113.1");
  expect(new TextDecoder().decode((await two.read()).value)).toBe("203.0.113.2");
  await one.cancel();
  await two.cancel();
  expect(cancelled.sort()).toEqual(["203.0.113.1", "203.0.113.2"]);
  expect(currentWorkerRequest()).toBeUndefined();
});

it("preserves an upstream response stream and propagates cancellation without buffering", async () => {
  const cancel = vi.fn(() => {
    expect(currentWorkerRequest()?.apiTransport).toBe(transport);
  });
  const transport = createWorkerApiTransport(
    {
      getByName: () => ({
        fetch: () =>
          Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode("first"));
                },
                cancel,
              }),
              { status: 206, headers: { "content-type": "text/event-stream" } },
            ),
          ),
      }),
    },
    "https://api.example.com",
    null,
    "secret",
    "",
  );
  const response = await runWorkerRequest(
    "postgres://one",
    async () => {
      const result = await transport(new Request("https://api.example.com/mcp"));
      if (!result) throw new Error("missing binding response");
      return result;
    },
    { apiTransport: transport },
  );
  expect(response.status).toBe(206);
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  if (!response.body) throw new Error("Missing response body");
  const reader = response.body.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("first");
  await reader.cancel("visitor left");
  expect(cancel).toHaveBeenCalledExactlyOnceWith("visitor left");
});

it("keeps health, schema and ATProto identity API calls on the binding with verified internal auth", async () => {
  const urls: string[] = [];
  const transport = createWorkerApiTransport(
    {
      getByName: () => ({
        fetch: (request: Request) => {
          urls.push(request.url);
          expect(request.headers.get("x-atlas-internal-secret")).toBe("verified-session-secret");
          expect(request.headers.get("x-atlas-actor-id")).toBe("verified-user");
          return Promise.resolve(new Response(null, { status: 204 }));
        },
      }),
    },
    "https://api.example.com",
    null,
    "secret",
    "",
  );
  for (const path of ["/health", "/openapi.json", "/api/atproto/identities/sign-in/resolve"])
    expect(
      (
        await transport(
          new Request("https://api.example.com" + path, {
            headers: {
              "x-atlas-internal-secret": "verified-session-secret",
              "x-atlas-actor-id": "verified-user",
            },
          }),
        )
      )?.status,
    ).toBe(204);
  expect(urls).toEqual([
    "https://api.example.com/health",
    "https://api.example.com/openapi.json",
    "https://api.example.com/api/atproto/identities/sign-in/resolve",
  ]);
});

it("uses the explicit evaluation prefix while production preserves original routes", async () => {
  const urls: string[] = [];
  const binding = {
    getByName: () => ({
      fetch: (request: Request) => {
        urls.push(request.url);
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    }),
  };
  for (const prefix of ["", "/atlas"] as const) {
    const transport = createWorkerApiTransport(
      binding,
      "https://api.example.com",
      null,
      "secret",
      prefix,
    );
    await transport(new Request("https://api.example.com/api/entities?limit=1"));
  }
  expect(urls).toEqual([
    "https://api.example.com/api/entities?limit=1",
    "https://api.example.com/atlas/api/entities?limit=1",
  ]);
});

it("rejects missing or unrecognized binding route prefixes before dispatch", () => {
  const binding = { getByName: vi.fn() };
  for (const prefix of [undefined, "/unexpected"]) {
    expect(() =>
      createWorkerApiTransport(binding, "https://api.example.com", null, "secret", prefix as ""),
    ).toThrow("API binding route prefix must be explicit");
  }
  expect(binding.getByName).not.toHaveBeenCalled();
});
