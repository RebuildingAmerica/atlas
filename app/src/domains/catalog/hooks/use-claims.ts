/**
 * React Query hooks around the profile-claim, manage, follow, lists, and feed APIs.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addSavedListItem,
  createSavedList,
  deleteSavedList,
  followProfile,
  getFollowingFeed,
  getProfileFollow,
  getSavedList,
  getSavedListMembership,
  initiateProfileClaim,
  listMyProfileClaims,
  listSavedLists,
  manageProfile,
  removeSavedListItem,
  unfollowProfile,
  verifyProfileClaim,
  type ProfileClaimRequest,
  type ProfileManageRequest,
  type ProfileClaimResponse,
  type ProfileClaimVerifyRequest,
  type ProfileFollowResponse,
  type SavedListCreateRequest,
  type SavedListItemRequest,
  type SavedListItemResponse,
  type SavedListResponse,
} from "@/lib/generated/atlas";

const CLAIMS_KEY = ["profile-claims"] as const;
const LISTS_KEY = ["saved-lists"] as const;
const FEED_KEY = ["following-feed"] as const;
const FOLLOW_KEY = ["profile-follow"] as const;
const MEMBERSHIP_KEY = ["saved-list-membership"] as const;

export function useMyClaims() {
  return useQuery<ProfileClaimResponse[]>({
    queryKey: CLAIMS_KEY,
    queryFn: () => listMyProfileClaims(),
  });
}

export function useInitiateClaim() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, body }: { slug: string; body: ProfileClaimRequest }) =>
      initiateProfileClaim(slug, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CLAIMS_KEY });
    },
  });
}

export function useVerifyClaimEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ProfileClaimVerifyRequest) => verifyProfileClaim(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CLAIMS_KEY });
    },
  });
}

export function useManageProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, body }: { slug: string; body: ProfileManageRequest }) =>
      manageProfile(slug, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CLAIMS_KEY });
    },
  });
}

export function useProfileFollow(slug: string, enabled: boolean) {
  return useQuery<ProfileFollowResponse | null>({
    queryKey: [...FOLLOW_KEY, slug],
    queryFn: () => getProfileFollow(slug),
    enabled,
  });
}

export function useFollowProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => followProfile(slug),
    onSuccess: (_data, slug) => {
      void queryClient.invalidateQueries({ queryKey: [...FOLLOW_KEY, slug] });
      void queryClient.invalidateQueries({ queryKey: FEED_KEY });
    },
  });
}

export function useUnfollowProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => unfollowProfile(slug),
    onSuccess: (_data, slug) => {
      void queryClient.invalidateQueries({ queryKey: [...FOLLOW_KEY, slug] });
      void queryClient.invalidateQueries({ queryKey: FEED_KEY });
    },
  });
}

export function useFollowingFeed(limit = 50) {
  return useQuery({
    queryKey: [...FEED_KEY, limit],
    queryFn: () => getFollowingFeed({ limit }),
  });
}

export function useSavedLists() {
  return useQuery<SavedListResponse[]>({
    queryKey: LISTS_KEY,
    queryFn: () => listSavedLists(),
  });
}

export function useSavedList(listId: string, enabled: boolean) {
  return useQuery<SavedListResponse>({
    queryKey: [...LISTS_KEY, listId],
    queryFn: () => getSavedList(listId),
    enabled,
  });
}

export function useCreateSavedList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SavedListCreateRequest) => createSavedList(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LISTS_KEY });
    },
  });
}

export function useDeleteSavedList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (listId: string) => deleteSavedList(listId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LISTS_KEY });
    },
  });
}

export function useAddSavedListItem() {
  const queryClient = useQueryClient();
  return useMutation<
    SavedListItemResponse,
    unknown,
    { listId: string; body: SavedListItemRequest }
  >({
    mutationFn: ({ listId, body }) => addSavedListItem(listId, body),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: [...LISTS_KEY, variables.listId] });
      void queryClient.invalidateQueries({ queryKey: LISTS_KEY });
      void queryClient.invalidateQueries({ queryKey: MEMBERSHIP_KEY });
    },
  });
}

export function useRemoveSavedListItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ listId, entryId }: { listId: string; entryId: string }) =>
      removeSavedListItem(listId, entryId),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: [...LISTS_KEY, variables.listId] });
      void queryClient.invalidateQueries({ queryKey: LISTS_KEY });
      void queryClient.invalidateQueries({ queryKey: MEMBERSHIP_KEY });
    },
  });
}

export function useSavedListMembership(entryId: string, enabled: boolean) {
  return useQuery<string[]>({
    queryKey: [...MEMBERSHIP_KEY, entryId],
    queryFn: () => getSavedListMembership(entryId),
    enabled,
  });
}
