import { afterEach, describe, expect, it, vi } from "vitest";
import { API_APPROVAL, APPROVAL } from "../../../fixtures/editorial/editorial-activity";

const mocks = vi.hoisted(() => ({ requestAtlasApi: vi.fn() }));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});
vi.mock("@/domains/discovery/server/api-client", () => ({
  requestAtlasApi: mocks.requestAtlasApi,
}));

afterEach(() => {
  vi.resetModules();
  mocks.requestAtlasApi.mockReset();
});

describe("editorial activity server function", () => {
  it("reads the newest page of the audit log", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ items: [API_APPROVAL], next_before: "cursor-1" });
    const { listEditorialActivity } =
      await import("@/domains/editorial/editorial-activity.functions");

    await expect(listEditorialActivity({ data: { before: null } })).resolves.toEqual({
      items: [APPROVAL],
      nextBefore: "cursor-1",
    });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/audit-log?limit=50");
  });

  it("reads an older page, and names the local operator by id", async () => {
    mocks.requestAtlasApi.mockResolvedValue({
      items: [{ ...API_APPROVAL, actor_email: "", actor_id: "local" }],
      next_before: null,
    });
    const { listEditorialActivity } =
      await import("@/domains/editorial/editorial-activity.functions");

    const page = await listEditorialActivity({ data: { before: "cursor-1" } });

    expect(page.items[0]?.actor).toBe("local");
    expect(page.nextBefore).toBeNull();
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/audit-log?limit=50&before=cursor-1");
  });
});
