import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerFnExecutionResponse } from "../../../helpers/server-fn-stub";
import { createAtlasSessionFixture } from "../../../fixtures/access/sessions";

const mocks = vi.hoisted(() => ({
  getAuthRuntimeConfig: vi.fn(),
  listScoutDevicesForUser: vi.fn(),
  requireAtlasSessionState: vi.fn(),
  revokeScoutDevice: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
}));

vi.mock("@/domains/access/server/session-state", () => ({
  requireAtlasSessionState: mocks.requireAtlasSessionState,
}));

vi.mock("@/domains/access/server/scout-devices", () => ({
  listScoutDevicesForUser: mocks.listScoutDevicesForUser,
  revokeScoutDevice: mocks.revokeScoutDevice,
}));

describe("scout-devices.functions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.resetModules();
    mocks.getAuthRuntimeConfig.mockReset();
    mocks.listScoutDevicesForUser.mockReset();
    mocks.requireAtlasSessionState.mockReset();
    mocks.revokeScoutDevice.mockReset();
    mocks.getAuthRuntimeConfig.mockReturnValue({
      apiBaseUrl: "http://atlas-api.test",
      internalSecret: "internal-secret",
      localMode: false,
    });
    mocks.requireAtlasSessionState.mockResolvedValue(
      createAtlasSessionFixture({
        user: {
          email: "operator@atlas.test",
          id: "user-123",
        },
      }),
    );
  });

  it("returns an empty list while auth is disabled", async () => {
    mocks.getAuthRuntimeConfig.mockReturnValue({ localMode: true });
    const { listScoutDevices } = await import("@/domains/access/scout-devices.functions");

    const response = (await listScoutDevices.__executeServer({
      data: undefined,
      method: "GET",
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual([]);
    expect(mocks.requireAtlasSessionState).not.toHaveBeenCalled();
  });

  it("lists enrolled Scout devices for the signed-in user", async () => {
    mocks.listScoutDevicesForUser.mockResolvedValue([
      {
        createdAt: "2026-07-04T16:00:00.000Z",
        defaultUploadTarget: "workspace",
        id: "worker-123",
        lastSeenAt: "2026-07-04T17:00:00.000Z",
        revokedAt: null,
        searchKeyConfigured: true,
        userId: "user-123",
        workerName: "Laptop",
        workspaceId: "org-123",
      },
    ]);
    const { listScoutDevices } = await import("@/domains/access/scout-devices.functions");

    const response = (await listScoutDevices.__executeServer({
      data: undefined,
      method: "GET",
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual([
      {
        createdAt: "2026-07-04T16:00:00.000Z",
        defaultUploadTarget: "workspace",
        id: "worker-123",
        lastSeenAt: "2026-07-04T17:00:00.000Z",
        revokedAt: null,
        searchKeyConfigured: true,
        workerName: "Laptop",
        workspaceId: "org-123",
      },
    ]);
    expect(mocks.listScoutDevicesForUser).toHaveBeenCalledWith("user-123");
  });

  it("revokes a Scout device owned by the signed-in user", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { revokeScoutDevice: revokeScoutDeviceFn } =
      await import("@/domains/access/scout-devices.functions");

    const response = (await revokeScoutDeviceFn.__executeServer({
      data: { deviceId: "worker-123" },
      method: "POST",
    })) as ServerFnExecutionResponse;

    expect(response.error).toBeUndefined();
    expect(mocks.revokeScoutDevice).toHaveBeenCalledWith({
      deviceId: "worker-123",
      userId: "user-123",
    });
    const releaseCall = fetchMock.mock.calls[0];
    if (!releaseCall) throw new Error("Expected Scout lease release request.");
    const [releaseUrl, releaseInit] = releaseCall;
    expect(releaseUrl).toBe(
      "http://atlas-api.test/api/discovery-runs/jobs/workers/worker-123/release",
    );
    expect(releaseInit?.method).toBe("POST");
    expect(releaseInit?.headers).toMatchObject({
      "X-Atlas-Actor-Email": "operator@atlas.test",
      "X-Atlas-Actor-Id": "user-123",
      "X-Atlas-Internal-Secret": "internal-secret",
    });
  });
});
