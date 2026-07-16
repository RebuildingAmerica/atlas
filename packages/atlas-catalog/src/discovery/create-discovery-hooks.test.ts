import { describe, expect, it, vi } from "vitest";
import { createDiscoveryHooks, type DiscoveryClient } from "./create-discovery-hooks";

function createClient(): DiscoveryClient {
  return {
    getRun: vi.fn(),
    listJobQueue: vi.fn(),
    listRuns: vi.fn(),
    startRun: vi.fn(),
  };
}

describe("createDiscoveryHooks", () => {
  it("keeps completed discovery runs out of the polling loop", () => {
    const hooks = createDiscoveryHooks(createClient());
    const options = hooks.discoveryRunsQueryOptions();
    const interval = options.refetchInterval;

    expect(typeof interval).toBe("function");
    expect(
      (interval as (query: never) => false | number)({
        state: { data: { items: [{ status: "complete" }] } },
      } as never),
    ).toBe(false);
  });

  it("polls running work quickly before falling back to a slower interval", () => {
    const hooks = createDiscoveryHooks(createClient());
    const options = hooks.discoveryRunQueryOptions("run_1");
    const now = Date.now();
    const interval = options.refetchInterval;

    expect(typeof interval).toBe("function");
    const evaluate = interval as (query: never) => false | number;
    expect(evaluate({ state: { data: undefined, dataUpdatedAt: now } } as never)).toBe(3000);
    expect(evaluate({ state: { data: { status: "running" }, dataUpdatedAt: now } } as never)).toBe(3000);
    expect(
      evaluate({ state: { data: { status: "running" }, dataUpdatedAt: now - 61_000 } } as never),
    ).toBe(10_000);
  });
});
