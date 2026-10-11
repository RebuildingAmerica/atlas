import { describe, expect, it } from "vitest";
import {
  runWorkerRequest,
  requestResource,
  currentWorkerRequest,
} from "../../../../../server/request-scope";

describe("Workers request ownership", () => {
  it("keeps overlapping requests and resources isolated and releases after streaming", async () => {
    const closed: string[] = [];
    const seen: string[] = [];
    const request = (name: string) =>
      runWorkerRequest("postgres://" + name, async () => {
        expect(currentWorkerRequest()?.connectionString).toBe("postgres://" + name);
        const object = requestResource("identity", () => ({ name }));
        expect(requestResource("identity", () => ({ name: "wrong" }))).toBe(object);
        currentWorkerRequest()?.cleanup.push(() => {
          closed.push(name);
          return Promise.resolve();
        });
        await new Promise((resolve) => setTimeout(resolve, 1));
        seen.push(
          requestResource<{ name: string }>("identity", () => ({ name: "wrong" }))?.name ??
            "missing",
        );
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(name));
              controller.close();
            },
          }),
        );
      });
    const [a, b] = await Promise.all([request("a"), request("b")]);
    expect(closed).toEqual([]);
    expect(await a.text()).toBe("a");
    expect(await b.text()).toBe("b");
    expect(seen.sort()).toEqual(["a", "b"]);
    expect(closed.sort()).toEqual(["a", "b"]);
    expect(currentWorkerRequest()).toBeUndefined();
    expect(requestResource("absent", () => 1)).toBeUndefined();
  });
  it("releases resources on handler errors and bodyless responses", async () => {
    let count = 0;
    await expect(
      runWorkerRequest("postgres://a", () => {
        currentWorkerRequest()?.cleanup.push(() => {
          count++;
          return Promise.resolve();
        });
        return Promise.reject(new Error("failed"));
      }),
    ).rejects.toThrow("failed");
    await runWorkerRequest("postgres://a", () => {
      currentWorkerRequest()?.cleanup.push(() => {
        count++;
        return Promise.resolve();
      });
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    expect(count).toBe(2);
  });
});
