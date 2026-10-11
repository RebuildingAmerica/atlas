import { afterEach, expect, it, vi } from "vitest";
import type worker from "../../../../../server/worker";
import {
  currentWorkerRequest,
  requestResource,
  runWorkerRequest,
} from "../../../../../server/request-scope";

const calls = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../../../../server/worker", () => ({ default: { fetch: calls.fetch } }));
afterEach(() => vi.clearAllMocks());

it("uses four fixed production objects without deriving placement from a visitor", async () => {
  const { default: edge } = await import("../../../../../server/durable-production");
  const names: string[] = [];
  const headers = new Headers({ "cache-control": "private, no-store" });
  headers.append("set-cookie", "one=1; HttpOnly");
  headers.append("set-cookie", "two=2; HttpOnly");
  const response = new Response("streamed", { status: 201, headers });
  const requests: Request[] = [];
  const env = {
    APP_RUNTIME: {
      getByName(name: string) {
        names.push(name);
        return {
          fetch(request: Request) {
            requests.push(request);
            return Promise.resolve(response);
          },
        };
      },
    },
  };
  for (let i = 0; i < 12; i++) {
    const request = new Request("https://atlas.test/api/auth/example", {
      method: "POST",
      body: "payload",
      headers: { cookie: `visitor=${i}`, "cf-connecting-ip": `203.0.113.${i}` },
    });
    expect(await edge.fetch(request, env)).toBe(response);
    expect(requests[i]).toBe(request);
  }
  expect(names).toEqual(Array.from({ length: 12 }, (_, i) => `application-${i % 4}`));
  expect(response.headers.getSetCookie()).toEqual(["one=1; HttpOnly", "two=2; HttpOnly"]);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.text()).toBe("streamed");
});

it("keeps visitors isolated through overlapping response streams in one production object", async () => {
  const { AtlasAppRuntime } = await import("../../../../../server/durable-production");
  const closed: string[] = [];
  calls.fetch.mockImplementation((request: Request) =>
    runWorkerRequest("postgres://disposable", async () => {
      const user = request.headers.get("cookie") ?? "anonymous";
      requestResource("identity", () => user);
      currentWorkerRequest()?.cleanup.push(() => {
        closed.push(user);
        return Promise.resolve();
      });
      await Promise.resolve();
      return new Response(
        new ReadableStream({
          async pull(controller) {
            await Promise.resolve();
            controller.enqueue(
              new TextEncoder().encode(requestResource("identity", () => "wrong")),
            );
            controller.close();
          },
        }),
      );
    }),
  );
  const env = { HYPERDRIVE: { connectionString: "postgres://disposable" } } as Parameters<
    typeof worker.fetch
  >[1];
  const object = new AtlasAppRuntime(undefined, env);
  const responses = await Promise.all(
    ["one", "two"].map((cookie) =>
      object.fetch(new Request("https://atlas.test/account", { headers: { cookie } })),
    ),
  );
  expect(await Promise.all(responses.map((response) => response.text()))).toEqual(["one", "two"]);
  expect(closed.sort()).toEqual(["one", "two"]);
  expect(currentWorkerRequest()).toBeUndefined();
  for (const call of calls.fetch.mock.calls) expect(call[1]).toBe(env);
});

it("propagates stream cancellation and request failures unchanged", async () => {
  const { AtlasAppRuntime } = await import("../../../../../server/durable-production");
  const cancel = vi.fn();
  calls.fetch.mockResolvedValueOnce(new Response(new ReadableStream({ cancel })));
  const env = { HYPERDRIVE: { connectionString: "postgres://disposable" } } as Parameters<
    typeof worker.fetch
  >[1];
  const object = new AtlasAppRuntime(undefined, env);
  const response = await object.fetch(new Request("https://atlas.test/account"));
  await response.body?.cancel("visitor left");
  expect(cancel).toHaveBeenCalledWith("visitor left");
  const error = new Error("request failed");
  calls.fetch.mockRejectedValueOnce(error);
  await expect(object.fetch(new Request("https://atlas.test/account"))).rejects.toBe(error);
});
