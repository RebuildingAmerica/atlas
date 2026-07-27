// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access", () => ({
  useAtlasSession: vi.fn(),
}));

vi.mock("@/domains/access/atproto-identities", () => ({
  useAtprotoIdentities: vi.fn(),
}));

vi.mock("@/domains/catalog/hooks/use-claims", () => ({
  useInitiateClaim: vi.fn(),
  useMyClaims: vi.fn(),
  useVerifyClaimDomain: vi.fn(),
  useVerifyClaimEmail: vi.fn(),
}));

vi.mock("@/domains/catalog/server/profiles/profile-loaders", () => ({
  loadEntryBySlugAny: vi.fn(),
}));

vi.mock("@rebuildingamerica/atlas-ui/layout/page-layout", () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// The submission panel disables its own button while these conditions hold, so
// the route's guards are unreachable through it. This stub keeps the button
// live so the guards themselves -- the last line of defence before a claim is
// filed -- are the thing under test.
vi.mock("@/routes/_public/claim/-claim-components", () => ({
  ClaimContextRail: () => null,
  ClaimHero: () => null,
  ClaimSubmissionPanel: ({
    isResolvingAtprotoIdentity,
    onSubmit,
  }: {
    isResolvingAtprotoIdentity: boolean;
    onSubmit: () => void;
  }) => (
    <button type="button" data-resolving={String(isResolvingAtprotoIdentity)} onClick={onSubmit}>
      Submit verification
    </button>
  ),
  PendingClaimPanel: () => null,
  SignedOutPanel: () => null,
  VerificationTokenPanel: () => null,
  VerifiedClaimPanel: () => null,
}));

describe("routes/_public/claim/$slug submit guards", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    const { useAtlasSession } = await import("@/domains/access");
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: { user: { id: "u1" } },
    } as unknown as ReturnType<typeof useAtlasSession>);
    vi.mocked(claims.useMyClaims).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof claims.useMyClaims>);
    vi.mocked(claims.useVerifyClaimEmail).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof claims.useVerifyClaimEmail>);
    vi.mocked(claims.useVerifyClaimDomain).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof claims.useVerifyClaimDomain>);
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
  });

  async function renderClaimRoute(search: Record<string, string>) {
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ slug: "acme" });
    router.useSearch.mockReturnValue(search);
    router.useLoaderData.mockReturnValue({
      entry: { id: "e1", name: "Acme", slug: "acme", type: "organization" },
    });
    const routeModule = await import("@/routes/_public/claim/$slug");
    const Component = asRouteStub(routeModule.Route).options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
  }

  async function submitVerification() {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit verification" }));
      await Promise.resolve();
    });
  }

  it("waits instead of filing a claim while the chosen ATProto identity is still resolving", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const { useAtprotoIdentities } = await import("@/domains/access/atproto-identities");
    const initiateMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(claims.useInitiateClaim).mockReturnValue({
      mutateAsync: initiateMock,
      isPending: false,
    } as unknown as ReturnType<typeof claims.useInitiateClaim>);
    vi.mocked(useAtprotoIdentities).mockReturnValue({
      data: undefined,
      isError: false,
      isLoading: false,
      isPending: true,
    } as unknown as ReturnType<typeof useAtprotoIdentities>);

    await renderClaimRoute({ atprotoIdentityId: "identity_1" });
    expect(screen.getByRole("button", { name: "Submit verification" })).toHaveAttribute(
      "data-resolving",
      "true",
    );

    await submitVerification();

    expect(initiateMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("refuses a generic Bluesky handle as an organization's only proof", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const { useAtprotoIdentities } = await import("@/domains/access/atproto-identities");
    const initiateMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(claims.useInitiateClaim).mockReturnValue({
      mutateAsync: initiateMock,
      isPending: false,
    } as unknown as ReturnType<typeof claims.useInitiateClaim>);
    vi.mocked(useAtprotoIdentities).mockReturnValue({
      data: [
        {
          connected_at: "2026-07-12T12:00:00Z",
          control_status: "active",
          current_handle: "eastsidehousing.bsky.social",
          did: "did:plc:acme",
          id: "identity_1",
          profiles: [],
          resolution_status: "verified",
          verified_at: "2026-07-12T12:00:00Z",
        },
      ],
      isError: false,
      isLoading: false,
      isPending: false,
    } as unknown as ReturnType<typeof useAtprotoIdentities>);

    await renderClaimRoute({ atprotoIdentityId: "identity_1" });
    await submitVerification();

    expect(initiateMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Add the organization domain or use a workspace where you manage this organization.",
    );
  });
});
