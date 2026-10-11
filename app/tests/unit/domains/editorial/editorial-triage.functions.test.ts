import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requestAtlasApi: vi.fn() }));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});

vi.mock("@/domains/discovery/server/api-client", () => ({
  requestAtlasApi: mocks.requestAtlasApi,
}));

describe("loadEditorialTriage", () => {
  afterEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
  });

  it("reads each queue's size and its longest-waiting item", async () => {
    mocks.requestAtlasApi.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith("/correction-inbox")
          ? { items: [{ created_at: "2026-10-06T09:00:00Z" }], total: 4 }
          : path.startsWith("/review-queue")
            ? { items: [], total: 0 }
            : { items: [{ created_at: "2026-10-09T10:00:00Z" }], total: 1 },
      ),
    );
    const { loadEditorialTriage } = await import("@/domains/editorial/editorial-triage.functions");

    const triage = await loadEditorialTriage();

    expect(mocks.requestAtlasApi).toHaveBeenNthCalledWith(1, "/correction-inbox?limit=1&offset=0");
    expect(mocks.requestAtlasApi).toHaveBeenNthCalledWith(2, "/review-queue?limit=1&offset=0");
    expect(mocks.requestAtlasApi).toHaveBeenNthCalledWith(
      3,
      "/profiles/claims/review?limit=1&offset=0",
    );
    expect(triage).toEqual({
      claims: { oldestAt: "2026-10-09T10:00:00Z", waiting: 1 },
      corrections: { oldestAt: "2026-10-06T09:00:00Z", waiting: 4 },
      discoveryReviews: { oldestAt: null, waiting: 0 },
    });
  });
});
