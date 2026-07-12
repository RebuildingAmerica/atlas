import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  disconnect: vi.fn(),
  invalidateQueries: vi.fn(),
  list: vi.fn(),
  refresh: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
  useQueryClient: mocks.useQueryClient,
}));

vi.mock("@/lib/generated/atlas/identity/identity", () => ({
  disconnectAtprotoIdentity: mocks.disconnect,
  listAtprotoIdentities: mocks.list,
  refreshAtprotoIdentity: mocks.refresh,
}));

describe("ATProto identity hooks", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.useQueryClient.mockReturnValue({ invalidateQueries: mocks.invalidateQueries });
    mocks.useMutation.mockImplementation((options: unknown) => options);
  });

  it("loads the account identity collection with the shared query key", async () => {
    mocks.list.mockResolvedValue([{ id: "identity-1" }]);
    const { atprotoIdentitiesQueryKey, useAtprotoIdentities } =
      await import("@/domains/access/atproto-identities");

    useAtprotoIdentities();
    const options = mocks.useQuery.mock.calls[0]?.[0] as {
      queryFn: () => Promise<unknown>;
      queryKey: readonly string[];
    };
    expect(options.queryKey).toEqual(atprotoIdentitiesQueryKey);
    await expect(options.queryFn()).resolves.toEqual([{ id: "identity-1" }]);
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it("refreshes and disconnects identities, invalidating the collection after either result", async () => {
    mocks.refresh.mockResolvedValue({ id: "identity-1" });
    mocks.disconnect.mockResolvedValue(undefined);
    const { atprotoIdentitiesQueryKey, useDisconnectAtprotoIdentity, useRefreshAtprotoIdentity } =
      await import("@/domains/access/atproto-identities");

    useRefreshAtprotoIdentity();
    useDisconnectAtprotoIdentity();
    const refresh = mocks.useMutation.mock.calls[0]?.[0] as {
      mutationFn: (id: string) => Promise<unknown>;
      onSettled: () => Promise<void>;
    };
    const disconnect = mocks.useMutation.mock.calls[1]?.[0] as {
      mutationFn: (id: string) => Promise<unknown>;
      onSettled: () => Promise<void>;
    };

    await expect(refresh.mutationFn("identity-1")).resolves.toEqual({ id: "identity-1" });
    await refresh.onSettled();
    await expect(disconnect.mutationFn("identity-1")).resolves.toBeUndefined();
    await disconnect.onSettled();
    expect(mocks.refresh).toHaveBeenCalledWith("identity-1");
    expect(mocks.disconnect).toHaveBeenCalledWith("identity-1");
    expect(mocks.invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: atprotoIdentitiesQueryKey,
    });
    expect(mocks.invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: atprotoIdentitiesQueryKey,
    });
  });
});
