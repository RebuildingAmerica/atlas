// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  ProfileClaimResponse,
  ProfileFollowResponse,
  SavedListResponse,
} from "@rebuildingamerica/atlas-api-client/generated/atlas";
import {
  useAddSavedListItem,
  useApproveProfileClaimReview,
  useAttachProfileAtprotoIdentity,
  useCreateSavedList,
  useDeleteSavedList,
  useDetachProfileAtprotoIdentity,
  useFollowProfile,
  useFollowingFeed,
  useInitiateClaim,
  useManageProfile,
  useMyClaims,
  useProfileClaimReviews,
  useProfileFollow,
  useRejectProfileClaimReview,
  useRemoveSavedListItem,
  useRevalidateProfileAtprotoLinks,
  useSavedList,
  useSavedListMembership,
  useSavedLists,
  useUnfollowProfile,
  useVerifyClaimDomain,
  useVerifyClaimEmail,
} from "@/domains/catalog/hooks/use-claims";
import { createTestQueryClient } from "../../../../helpers/render-with-providers";
import { stubFetch } from "../../../../helpers/stub-fetch";
import type { StubbedFetch, StubbedResponse } from "../../../../helpers/stub-fetch";

describe("profile claim, follow and saved-list hooks", () => {
  interface ProvidersProps {
    children: ReactNode;
  }

  interface RecordedRequest {
    body: unknown;
    method: string;
    target: string;
  }

  let queryClient: QueryClient;
  let http: StubbedFetch;
  let routes: Map<string, StubbedResponse>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    routes = new Map<string, StubbedResponse>();
    http = stubFetch((input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      const target = `${init?.method ?? "GET"} ${url.pathname}${url.search}`;
      return routes.get(target) ?? { body: { detail: `unrouted ${target}` }, status: 404 };
    });
  });

  function route(target: string, reply: StubbedResponse): void {
    routes.set(target, reply);
  }

  function Providers({ children }: ProvidersProps) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  function requests(): RecordedRequest[] {
    return http.requests.map((request) => ({
      body:
        typeof request.init?.body === "string"
          ? (JSON.parse(request.init.body) as unknown)
          : undefined,
      method: request.init?.method ?? "GET",
      target: new URL(request.url).pathname + new URL(request.url).search,
    }));
  }

  function targets(): string[] {
    return requests().map((request) => `${request.method} ${request.target}`);
  }

  function claim(overrides: Partial<ProfileClaimResponse> = {}): ProfileClaimResponse {
    return {
      created_at: "2026-01-01T00:00:00Z",
      entry_id: "entry_1",
      entry_name: "Casa Verde",
      entry_slug: "casa-verde",
      id: "claim_1",
      status: "pending",
      tier: 2,
      updated_at: "2026-01-02T00:00:00Z",
      user_email: "rep@casaverde.org",
      user_id: "user_1",
      ...overrides,
    };
  }

  function follow(): ProfileFollowResponse {
    return {
      created_at: "2026-01-03T00:00:00Z",
      entry_id: "entry_1",
      subscribed_to: "sources",
      user_id: "user_1",
    };
  }

  function savedList(overrides: Partial<SavedListResponse> = {}): SavedListResponse {
    return {
      created_at: "2026-01-01T00:00:00Z",
      id: "list_1",
      item_count: 0,
      name: "Housing leads",
      updated_at: "2026-01-01T00:00:00Z",
      user_id: "user_1",
      ...overrides,
    };
  }

  describe("useMyClaims", () => {
    it("returns the claims the signed-in user already filed", async () => {
      route("GET /api/profiles/claims/me", { body: [claim()] });

      const { result } = renderHook(() => useMyClaims(), { wrapper: Providers });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(result.current.data).toEqual([claim()]);
      expect(targets()).toEqual(["GET /api/profiles/claims/me"]);
    });

    it("surfaces a failure rather than an empty list", async () => {
      route("GET /api/profiles/claims/me", { body: "nope", status: 500 });

      const { result } = renderHook(() => useMyClaims(), { wrapper: Providers });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
      expect(result.current.data).toBeUndefined();
    });
  });

  describe("useInitiateClaim", () => {
    it("posts the claim to the profile and refreshes the list the user is looking at", async () => {
      route("GET /api/profiles/claims/me", { body: [] });
      route("POST /api/profiles/casa-verde/claim", { body: claim() });

      const { result } = renderHook(
        () => ({ claims: useMyClaims(), initiate: useInitiateClaim() }),
        { wrapper: Providers },
      );
      await waitFor(() => {
        expect(result.current.claims.isSuccess).toBe(true);
      });

      route("GET /api/profiles/claims/me", { body: [claim()] });
      const created = await result.current.initiate.mutateAsync({
        body: { relationship: "staff" },
        slug: "casa-verde",
      });

      expect(created).toEqual(claim());
      expect(requests().at(1)).toEqual({
        body: { relationship: "staff" },
        method: "POST",
        target: "/api/profiles/casa-verde/claim",
      });
      await waitFor(() => {
        expect(result.current.claims.data).toEqual([claim()]);
      });
    });
  });

  describe("useVerifyClaimEmail", () => {
    it("exchanges the emailed token and invalidates the claim list", async () => {
      queryClient.setQueryData(["profile-claims"], [claim()]);
      route("POST /api/profiles/claims/verify-email", { body: claim({ status: "verified" }) });

      const { result } = renderHook(() => useVerifyClaimEmail(), { wrapper: Providers });
      const verified = await result.current.mutateAsync({ token: "tok_abc" });

      expect(verified.status).toBe("verified");
      expect(requests().at(0)).toEqual({
        body: { token: "tok_abc" },
        method: "POST",
        target: "/api/profiles/claims/verify-email",
      });
      expect(queryClient.getQueryState(["profile-claims"])?.isInvalidated).toBe(true);
    });
  });

  describe("useVerifyClaimDomain", () => {
    it("asks the API to re-check the DNS record for one claim", async () => {
      queryClient.setQueryData(["profile-claims"], [claim()]);
      route("POST /api/profiles/casa-verde/claims/claim_1/verify-domain", {
        body: claim({ status: "verified" }),
      });

      const { result } = renderHook(() => useVerifyClaimDomain(), { wrapper: Providers });
      await result.current.mutateAsync({ claimId: "claim_1", slug: "casa-verde" });

      expect(requests().at(0)).toEqual({
        body: {},
        method: "POST",
        target: "/api/profiles/casa-verde/claims/claim_1/verify-domain",
      });
      expect(queryClient.getQueryState(["profile-claims"])?.isInvalidated).toBe(true);
    });
  });

  describe("useProfileClaimReviews", () => {
    it("loads the review queue", async () => {
      route("GET /api/profiles/claims/review", { body: { items: [claim()], total: 1 } });

      const { result } = renderHook(() => useProfileClaimReviews(), { wrapper: Providers });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(result.current.data).toEqual({ items: [claim()], total: 1 });
    });

    it("stays idle for a reviewer who is not allowed to see the queue", () => {
      const { result } = renderHook(() => useProfileClaimReviews({ enabled: false }), {
        wrapper: Providers,
      });

      expect(result.current.fetchStatus).toBe("idle");
      expect(http.requests).toHaveLength(0);
    });
  });

  describe("review decisions", () => {
    it("approves a claim and refetches the queue behind it", async () => {
      route("GET /api/profiles/claims/review", { body: { items: [claim()], total: 1 } });
      route("POST /api/profiles/claims/review/claim_1/approve", { body: claim() });

      const { result } = renderHook(
        () => ({ approve: useApproveProfileClaimReview(), reviews: useProfileClaimReviews() }),
        { wrapper: Providers },
      );
      await waitFor(() => {
        expect(result.current.reviews.isSuccess).toBe(true);
      });

      route("GET /api/profiles/claims/review", { body: { items: [], total: 0 } });
      await result.current.approve.mutateAsync({
        body: { note: "verified by phone" },
        claimId: "claim_1",
      });

      expect(requests().at(1)).toEqual({
        body: { note: "verified by phone" },
        method: "POST",
        target: "/api/profiles/claims/review/claim_1/approve",
      });
      await waitFor(() => {
        expect(result.current.reviews.data).toEqual({ items: [], total: 0 });
      });
    });

    it("rejects a claim and invalidates the queue", async () => {
      queryClient.setQueryData(["profile-claim-review"], { items: [claim()], total: 1 });
      route("POST /api/profiles/claims/review/claim_1/reject", { body: claim() });

      const { result } = renderHook(() => useRejectProfileClaimReview(), { wrapper: Providers });
      await result.current.mutateAsync({ body: { note: "no evidence" }, claimId: "claim_1" });

      expect(requests().at(0)).toEqual({
        body: { note: "no evidence" },
        method: "POST",
        target: "/api/profiles/claims/review/claim_1/reject",
      });
      expect(queryClient.getQueryState(["profile-claim-review"])?.isInvalidated).toBe(true);
    });

    it("reports how many linked identities still need attention after revalidation", async () => {
      queryClient.setQueryData(["profile-claim-review"], { items: [], total: 0 });
      route("POST /api/profiles/claims/review/atproto/revalidate", {
        body: { checked: 12, needs_attention: 3 },
      });

      const { result } = renderHook(() => useRevalidateProfileAtprotoLinks(), {
        wrapper: Providers,
      });
      const outcome = await result.current.mutateAsync();

      expect(outcome).toEqual({ checked: 12, needs_attention: 3 });
      expect(targets()).toEqual(["POST /api/profiles/claims/review/atproto/revalidate"]);
      expect(queryClient.getQueryState(["profile-claim-review"])?.isInvalidated).toBe(true);
    });
  });

  describe("useManageProfile", () => {
    it("patches the subject-managed fields for one profile", async () => {
      queryClient.setQueryData(["profile-claims"], [claim()]);
      route("PATCH /api/profiles/casa-verde/manage", { body: { custom_bio: "We build homes." } });

      const { result } = renderHook(() => useManageProfile(), { wrapper: Providers });
      const updated = await result.current.mutateAsync({
        body: { clear_photo: true, custom_bio: "We build homes." },
        slug: "casa-verde",
      });

      expect(updated).toEqual({ custom_bio: "We build homes." });
      expect(requests().at(0)).toEqual({
        body: { clear_photo: true, custom_bio: "We build homes." },
        method: "PATCH",
        target: "/api/profiles/casa-verde/manage",
      });
      expect(queryClient.getQueryState(["profile-claims"])?.isInvalidated).toBe(true);
    });
  });

  describe("atproto identity attachment", () => {
    it("attaches an identity and invalidates both the identity list and the entries", async () => {
      queryClient.setQueryData(["auth", "atproto-identities"], []);
      queryClient.setQueryData(["entries"], []);
      route("PUT /api/profiles/casa-verde/atproto-identity", {
        body: {
          current_handle: "casaverde.org",
          did: "did:plc:abc",
          identity_id: "identity_1",
          status: "verified",
        },
      });

      const { result } = renderHook(() => useAttachProfileAtprotoIdentity(), {
        wrapper: Providers,
      });
      const linked = await result.current.mutateAsync({
        body: { atproto_identity_id: "identity_1", replace: true },
        slug: "casa-verde",
      });

      expect(linked.did).toBe("did:plc:abc");
      expect(requests().at(0)).toEqual({
        body: { atproto_identity_id: "identity_1", replace: true },
        method: "PUT",
        target: "/api/profiles/casa-verde/atproto-identity",
      });
      expect(queryClient.getQueryState(["auth", "atproto-identities"])?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(["entries"])?.isInvalidated).toBe(true);
    });

    it("detaches an identity from the profile", async () => {
      queryClient.setQueryData(["auth", "atproto-identities"], []);
      queryClient.setQueryData(["entries"], []);
      route("DELETE /api/profiles/casa-verde/atproto-identity", { status: 204 });

      const { result } = renderHook(() => useDetachProfileAtprotoIdentity(), {
        wrapper: Providers,
      });
      await result.current.mutateAsync("casa-verde");

      expect(targets()).toEqual(["DELETE /api/profiles/casa-verde/atproto-identity"]);
      expect(queryClient.getQueryState(["auth", "atproto-identities"])?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(["entries"])?.isInvalidated).toBe(true);
    });
  });

  describe("following a profile", () => {
    it("reads the visitor's follow state for one profile", async () => {
      route("GET /api/profiles/casa-verde/follow", { body: follow() });

      const { result } = renderHook(() => useProfileFollow("casa-verde", true), {
        wrapper: Providers,
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(result.current.data).toEqual(follow());
    });

    it("does not ask about follow state for a signed-out visitor", () => {
      const { result } = renderHook(() => useProfileFollow("casa-verde", false), {
        wrapper: Providers,
      });

      expect(result.current.fetchStatus).toBe("idle");
      expect(http.requests).toHaveLength(0);
    });

    it("follows a profile and turns the button's own state to followed", async () => {
      route("GET /api/profiles/casa-verde/follow", { body: null });
      route("POST /api/profiles/casa-verde/follow", { body: follow() });

      const { result } = renderHook(
        () => ({ followMutation: useFollowProfile(), state: useProfileFollow("casa-verde", true) }),
        { wrapper: Providers },
      );
      await waitFor(() => {
        expect(result.current.state.isSuccess).toBe(true);
      });
      expect(result.current.state.data).toBeNull();

      route("GET /api/profiles/casa-verde/follow", { body: follow() });
      await result.current.followMutation.mutateAsync("casa-verde");

      await waitFor(() => {
        expect(result.current.state.data).toEqual(follow());
      });
    });

    it("unfollows a profile and invalidates the feed as well as that profile", async () => {
      queryClient.setQueryData(["profile-follow", "casa-verde"], follow());
      queryClient.setQueryData(["following-feed", 50], {});
      route("DELETE /api/profiles/casa-verde/follow", { status: 204 });

      const { result } = renderHook(() => useUnfollowProfile(), { wrapper: Providers });
      await result.current.mutateAsync("casa-verde");

      expect(targets()).toEqual(["DELETE /api/profiles/casa-verde/follow"]);
      expect(queryClient.getQueryState(["profile-follow", "casa-verde"])?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(["following-feed", 50])?.isInvalidated).toBe(true);
    });
  });

  describe("useFollowingFeed", () => {
    it("asks for fifty events by default", async () => {
      route("GET /api/feed/following?limit=50", { body: { "2026-01-01": [{ id: "event_1" }] } });

      const { result } = renderHook(() => useFollowingFeed(), { wrapper: Providers });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(result.current.data).toEqual({ "2026-01-01": [{ id: "event_1" }] });
    });

    it("keys a narrower feed separately so the two do not share a cache entry", async () => {
      route("GET /api/feed/following?limit=5", { body: {} });

      const { result } = renderHook(() => useFollowingFeed(5), { wrapper: Providers });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(targets()).toEqual(["GET /api/feed/following?limit=5"]);
      expect(queryClient.getQueryData(["following-feed", 5])).toEqual({});
      expect(queryClient.getQueryData(["following-feed", 50])).toBeUndefined();
    });
  });

  describe("saved lists", () => {
    it("loads every list the user owns", async () => {
      route("GET /api/lists", { body: [savedList()] });

      const { result } = renderHook(() => useSavedLists(), { wrapper: Providers });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(result.current.data).toEqual([savedList()]);
    });

    it("loads one list only once the user opens it", async () => {
      const { result, rerender } = renderHook(
        (enabled: boolean) => useSavedList("list_1", enabled),
        { initialProps: false, wrapper: Providers },
      );
      expect(result.current.fetchStatus).toBe("idle");

      route("GET /api/lists/list_1", { body: savedList({ item_count: 2 }) });
      rerender(true);

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(result.current.data?.item_count).toBe(2);
      expect(targets()).toEqual(["GET /api/lists/list_1"]);
    });

    it("creates a list and shows it in the list index without a manual refresh", async () => {
      route("GET /api/lists", { body: [] });
      route("POST /api/lists", { body: savedList() });

      const { result } = renderHook(
        () => ({ create: useCreateSavedList(), lists: useSavedLists() }),
        { wrapper: Providers },
      );
      await waitFor(() => {
        expect(result.current.lists.isSuccess).toBe(true);
      });

      route("GET /api/lists", { body: [savedList()] });
      const created = await result.current.create.mutateAsync({ name: "Housing leads" });

      expect(created).toEqual(savedList());
      expect(requests().at(1)).toEqual({
        body: { name: "Housing leads" },
        method: "POST",
        target: "/api/lists",
      });
      await waitFor(() => {
        expect(result.current.lists.data).toEqual([savedList()]);
      });
    });

    it("deletes a list and invalidates the index", async () => {
      queryClient.setQueryData(["saved-lists"], [savedList()]);
      route("DELETE /api/lists/list_1", { status: 204 });

      const { result } = renderHook(() => useDeleteSavedList(), { wrapper: Providers });
      await result.current.mutateAsync("list_1");

      expect(targets()).toEqual(["DELETE /api/lists/list_1"]);
      expect(queryClient.getQueryState(["saved-lists"])?.isInvalidated).toBe(true);
    });

    it("adds an entry and invalidates the list, the index and the membership badge", async () => {
      queryClient.setQueryData(["saved-lists"], [savedList()]);
      queryClient.setQueryData(["saved-lists", "list_1"], savedList());
      queryClient.setQueryData(["saved-list-membership", "entry_1"], []);
      route("POST /api/lists/list_1/items", {
        body: {
          added_at: "2026-01-04T00:00:00Z",
          entry_id: "entry_1",
          list_id: "list_1",
          note: "call first",
        },
      });

      const { result } = renderHook(() => useAddSavedListItem(), { wrapper: Providers });
      const item = await result.current.mutateAsync({
        body: { entry_id: "entry_1", note: "call first" },
        listId: "list_1",
      });

      expect(item.list_id).toBe("list_1");
      expect(requests().at(0)).toEqual({
        body: { entry_id: "entry_1", note: "call first" },
        method: "POST",
        target: "/api/lists/list_1/items",
      });
      expect(queryClient.getQueryState(["saved-lists", "list_1"])?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(["saved-lists"])?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(["saved-list-membership", "entry_1"])?.isInvalidated).toBe(
        true,
      );
    });

    it("removes an entry and invalidates the same three views", async () => {
      queryClient.setQueryData(["saved-lists"], [savedList()]);
      queryClient.setQueryData(["saved-lists", "list_1"], savedList());
      queryClient.setQueryData(["saved-list-membership", "entry_1"], ["list_1"]);
      route("DELETE /api/lists/list_1/items/entry_1", { status: 204 });

      const { result } = renderHook(() => useRemoveSavedListItem(), { wrapper: Providers });
      await result.current.mutateAsync({ entryId: "entry_1", listId: "list_1" });

      expect(targets()).toEqual(["DELETE /api/lists/list_1/items/entry_1"]);
      expect(queryClient.getQueryState(["saved-lists", "list_1"])?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(["saved-lists"])?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(["saved-list-membership", "entry_1"])?.isInvalidated).toBe(
        true,
      );
    });

    it("reports which lists already hold an entry", async () => {
      route("GET /api/lists/membership/entry_1", { body: ["list_1", "list_2"] });

      const { result } = renderHook(() => useSavedListMembership("entry_1", true), {
        wrapper: Providers,
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
      expect(result.current.data).toEqual(["list_1", "list_2"]);
    });

    it("skips the membership lookup for a signed-out visitor", () => {
      const { result } = renderHook(() => useSavedListMembership("entry_1", false), {
        wrapper: Providers,
      });

      expect(result.current.fetchStatus).toBe("idle");
      expect(http.requests).toHaveLength(0);
    });
  });
});
