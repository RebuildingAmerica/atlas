import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerFnExecutionResponse } from "../../../helpers/server-fn-stub";

const mocks = vi.hoisted(() => ({
  disconnect: vi.fn(),
  invalidateQueries: vi.fn(),
  list: vi.fn(),
  provisionManaged: vi.fn(),
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

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});

vi.mock("@/domains/access/server/atproto-oauth", () => ({
  provisionAndLinkManagedAtprotoIdentity: mocks.provisionManaged,
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

  it("provisions the current user's managed identity and refreshes the collection", async () => {
    const managedIdentity = {
      current_handle: "civic.atlas.test",
      did: "did:plc:managed",
      id: "identity-managed",
      pds_url: "https://pds.atlas.test",
    };
    mocks.provisionManaged.mockResolvedValue(managedIdentity);
    const { provisionManagedAtprotoIdentityForCurrentUser, useProvisionManagedAtprotoIdentity } =
      await import("@/domains/access/atproto-identities");

    const response = (await provisionManagedAtprotoIdentityForCurrentUser.__executeServer({
      method: "POST",
      data: { handle: " civic.atlas.test " },
    })) as ServerFnExecutionResponse;
    useProvisionManagedAtprotoIdentity();
    const provision = mocks.useMutation.mock.calls[0]?.[0] as {
      mutationFn: (handle: string) => Promise<unknown>;
      onSettled: () => Promise<void>;
    };

    expect(response.error).toBeUndefined();
    expect(response.result).toEqual(managedIdentity);
    expect(mocks.provisionManaged).toHaveBeenCalledWith({ handle: "civic.atlas.test" });
    await expect(provision.mutationFn("civic.atlas.test")).resolves.toEqual(managedIdentity);
    await provision.onSettled();
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["auth", "atproto-identities"],
    });
  });
});
