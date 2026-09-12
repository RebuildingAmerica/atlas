// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import type { ProfileClaimResponse } from "@rebuildingamerica/atlas-api-client/generated/atlas";
import {
  useApproveProfileClaimReview,
  useAttachProfileAtprotoIdentity,
  useDetachProfileAtprotoIdentity,
  useManageProfile,
  useProfileClaimReviews,
  useRejectProfileClaimReview,
  useRevalidateProfileAtprotoLinks,
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
});
