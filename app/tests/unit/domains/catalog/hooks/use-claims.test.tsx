// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import type { ProfileClaimResponse } from "@rebuildingamerica/atlas-api-client/generated/atlas";
import {
  useInitiateClaim,
  useMyClaims,
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
});
