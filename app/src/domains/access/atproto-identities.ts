import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  disconnectAtprotoIdentity,
  listAtprotoIdentities,
  refreshAtprotoIdentity,
} from "@/lib/generated/atlas/identity/identity";
import type { AtprotoIdentityResponse } from "@/lib/generated/atlas-schemas";

export const atprotoIdentitiesQueryKey = ["auth", "atproto-identities"] as const;

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
