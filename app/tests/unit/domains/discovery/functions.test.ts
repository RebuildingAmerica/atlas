import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerFn: (() => {
    return () => {
      let validateInput: ((input: unknown) => unknown) | undefined;

      const builder = {
        inputValidator(
          validator: { parse?: (input: unknown) => unknown } | ((input: unknown) => unknown),
        ) {
          validateInput =
            typeof validator === "function"
              ? validator
              : (input) => validator.parse?.(input) ?? input;
          return builder;
        },
        handler(handler: (input: { data: unknown }) => unknown) {
          const execute = (input?: { data?: unknown }) =>
            Promise.resolve(
              handler({
                data: validateInput ? validateInput(input?.data) : input?.data,
              }),
            );

          return Object.assign(async (input?: { data?: unknown }) => execute(input), {
            __executeServer: async (
              input: {
                method?: string;
                data?: unknown;
                headers?: HeadersInit;
                context?: unknown;
              } = {},
            ) => ({
              context: undefined,
              error: undefined,
              result: await execute(input),
            }),
          });
        },
      };

      return builder;
    };
  })(),
  requestAtlasApi: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: mocks.createServerFn,
}));

vi.mock("@/domains/discovery/server/api-client", () => ({
  requestAtlasApi: mocks.requestAtlasApi,
}));

describe("discovery.functions", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
  });

  it("lists, loads, and starts discovery runs through the authenticated api client", async () => {
    mocks.requestAtlasApi
      .mockResolvedValueOnce({ items: [], total: 0 })
      .mockResolvedValueOnce({ id: "run_123" })
      .mockResolvedValueOnce({ id: "run_456" });

    const mod = await import("@/domains/discovery/functions");

    await expect(
      mod.listDiscoveryRuns.__executeServer({ method: "GET", data: undefined }),
    ).resolves.toMatchObject({
      result: { items: [], total: 0 },
    });
    await expect(
      mod.getDiscoveryRun.__executeServer({ method: "GET", data: { id: "run_123" } }),
    ).resolves.toMatchObject({
      result: { id: "run_123" },
    });
    await expect(
      mod.startDiscoveryRun.__executeServer({
        method: "POST",
        data: {
          issue_areas: ["housing"],
          location_query: "Kansas City",
          state: "MO",
        },
      }),
    ).resolves.toMatchObject({
      result: { id: "run_456" },
    });

    expect(mocks.requestAtlasApi).toHaveBeenNthCalledWith(1, "/discovery-runs");
    expect(mocks.requestAtlasApi).toHaveBeenNthCalledWith(2, "/discovery-runs/run_123");
    expect(mocks.requestAtlasApi).toHaveBeenNthCalledWith(3, "/discovery-runs", {
      body: JSON.stringify({
        issue_areas: ["housing"],
        location_query: "Kansas City",
        state: "MO",
      }),
      method: "POST",
    });
  });
});
