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

it("forwards complete requests to four bounded diagnostic objects and preserves streamed responses", async () => {
  const { default: edge } = await import("../../../../../server/durable-evaluation");
  const names: string[] = [];
  const responseHeaders = new Headers({ "cache-control": "private, no-store" });
  responseHeaders.append("set-cookie", "one=1; HttpOnly");
  responseHeaders.append("set-cookie", "two=2; HttpOnly");
  const env = {
    APP_RUNTIME: {
      getByName(name: string) {
        names.push(name);
        return {
          async fetch(request: Request) {
            expect(request.headers.get("cookie")).toBe("visitor=session");
            expect(request.headers.get("cf-connecting-ip")).toBe("203.0.113.4");
            return new Response(await request.text(), { status: 201, headers: responseHeaders });
          },
        };
      },
    },
  };
  for (let i = 0; i < 8; i++) {
    const response = await edge.fetch(
      new Request("https://candidate.test/api/example", {
        method: "POST",
        body: "payload",
        headers: { cookie: "visitor=session", "cf-connecting-ip": "203.0.113.4" },
      }),
      env,
    );
    expect(response.status).toBe(201);
    expect(response.headers.getSetCookie()).toEqual(["one=1; HttpOnly", "two=2; HttpOnly"]);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("payload");
  }
  expect(new Set(names).size).toBe(4);
  expect(names.slice(0, 4)).toEqual(names.slice(4));
});

it("keeps overlapping visitors and their deferred streams isolated inside one object", async () => {
  const { AtlasAppRuntime } = await import("../../../../../server/durable-evaluation");
  const closed: string[] = [];
  calls.fetch.mockImplementation((request: Request) =>
    runWorkerRequest("postgres://disposable", async () => {
      const user = request.headers.get("cookie") ?? "anonymous";
      requestResource("identity", () => user);
      currentWorkerRequest()?.cleanup.push(() => {
        closed.push(user);
        return Promise.resolve();
      });
      await new Promise((resolve) => setTimeout(resolve, 2));
      return new Response(
        new ReadableStream({
          async pull(controller) {
            await new Promise((resolve) => setTimeout(resolve, 2));
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
      object.fetch(new Request("https://candidate.test/account", { headers: { cookie } })),
    ),
  );
  expect(await Promise.all(responses.map((response) => response.text()))).toEqual(["one", "two"]);
  expect(closed.sort()).toEqual(["one", "two"]);
  expect(currentWorkerRequest()).toBeUndefined();
});

it("propagates cancellation so request-owned resources can close", async () => {
  const { AtlasAppRuntime } = await import("../../../../../server/durable-evaluation");
  const cancel = vi.fn();
  calls.fetch.mockResolvedValue(new Response(new ReadableStream({ cancel })));
  const env = { HYPERDRIVE: { connectionString: "postgres://disposable" } } as Parameters<
    typeof worker.fetch
  >[1];
  const response = await new AtlasAppRuntime(undefined, env).fetch(
    new Request("https://candidate.test"),
  );
  await response.body?.cancel("visitor left");
  expect(cancel).toHaveBeenCalledWith("visitor left");
});
