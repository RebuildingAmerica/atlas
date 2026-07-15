import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  disconnectAtprotoIdentity,
  listAtprotoIdentities,
  refreshAtprotoIdentity,
} from "@rebuildingamerica/atlas-api-client/generated/atlas/identity/identity";
import type { AtprotoIdentityResponse } from "@rebuildingamerica/atlas-api-client/generated/atlas-schemas";

export const atprotoIdentitiesQueryKey = ["auth", "atproto-identities"] as const;

interface ManagedAtprotoIdentity {
  current_handle: string;
  did: string;
  id: string;
  pds_url: string | null;
}

async function loadAtprotoOAuthModule() {
  if (import.meta.env.SSR) {
    return await import("./server/atproto-oauth");
  }

  throw new Error("Managed ATProto identity provisioning is only available on the server.");
}

/**
 * Provisions a public Atlas-managed ATProto identity for the current account.
 * The underlying PDS password and protocol sessions remain server-only.
 */
export const provisionManagedAtprotoIdentityForCurrentUser = createServerFn({ method: "POST" })
  .validator(
    z.object({
      handle: z.string().trim().min(3).max(253),
    }),
  )
  .handler(async ({ data }) => {
    const { provisionAndLinkManagedAtprotoIdentity } = await loadAtprotoOAuthModule();
    return await provisionAndLinkManagedAtprotoIdentity({ handle: data.handle });
  });

export function useAtprotoIdentities(): UseQueryResult<AtprotoIdentityResponse[]> {
  return useQuery({
    queryKey: atprotoIdentitiesQueryKey,
    queryFn: () => listAtprotoIdentities(),
  });
}

export function useRefreshAtprotoIdentity(): UseMutationResult<
  AtprotoIdentityResponse,
  Error,
  string
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (identityId) => refreshAtprotoIdentity(identityId),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: atprotoIdentitiesQueryKey });
    },
  });
}

export function useDisconnectAtprotoIdentity(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (identityId) => disconnectAtprotoIdentity(identityId),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: atprotoIdentitiesQueryKey });
    },
  });
}

export function useProvisionManagedAtprotoIdentity(): UseMutationResult<
  ManagedAtprotoIdentity,
  Error,
  string
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (handle) =>
      await provisionManagedAtprotoIdentityForCurrentUser({ data: { handle } }),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: atprotoIdentitiesQueryKey });
    },
  });
}
