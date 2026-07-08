// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access", () => ({
  useAtlasSession: vi.fn(),
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

vi.mock("@/lib/clipboard", () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/platform/ui/toast", () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

vi.mock("@/platform/layout/page-layout", () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/platform/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/platform/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

describe("routes/_public/claim/$slug verification", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    const { useAtlasSession } = await import("@/domains/access");
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(useAtlasSession).mockReset();
    vi.mocked(claims.useInitiateClaim).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    } as unknown as ReturnType<typeof claims.useInitiateClaim>);
    vi.mocked(claims.useVerifyClaimEmail).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    } as unknown as ReturnType<typeof claims.useVerifyClaimEmail>);
    vi.mocked(claims.useVerifyClaimDomain).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    } as unknown as ReturnType<typeof claims.useVerifyClaimDomain>);
    vi.mocked(claims.useMyClaims).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof claims.useMyClaims>);
  });

  afterEach(() => {
    cleanup();
  });

  async function loadClaimRoute() {
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    const routeModule = await import("@/routes/_public/claim/$slug");
    return { router, Route: asRouteStub(routeModule.Route) };
  }

  it("validates optional from/token search params and loads the entry by slug", async () => {
    const { loadEntryBySlugAny } =
      await import("@/domains/catalog/server/profiles/profile-loaders");
    const entry = { id: "e1", name: "Acme", slug: "acme", type: "organization" };
    vi.mocked(loadEntryBySlugAny).mockResolvedValue(
      entry as Awaited<ReturnType<typeof loadEntryBySlugAny>>,
    );

    const { Route } = await loadClaimRoute();
    const validator = Route.options.validateSearch as { parse: (input: unknown) => unknown };
    expect(
      validator.parse({
        from: "email",
        token: "tok",
        atprotoIdentityId: "atp_1",
        atprotoHandle: "acme.org",
        atprotoError: "ATProto identity could not be verified.",
      }),
    ).toEqual({
      atprotoError: "ATProto identity could not be verified.",
      atprotoHandle: "acme.org",
      atprotoIdentityId: "atp_1",
      from: "email",
      token: "tok",
    });

    if (!Route.options.loader) throw new Error("Expected loader");
    const data = await Route.options.loader({ params: { slug: "acme" } });
    expect(data).toEqual({ entry });

    if (!Route.options.head) throw new Error("Expected head");
    expect(Route.options.head({ loaderData: undefined })).toEqual({});
    const head = Route.options.head({ loaderData: { entry } }) as {
      meta: Record<string, string>[];
      links: Record<string, string>[];
    };
    expect(head.meta).toEqual(
      expect.arrayContaining([
        { title: "Verify Acme | Atlas" },
        { property: "og:url", content: "https://atlas.rebuildingamerica.com/claim/acme" },
        { name: "robots", content: "noindex,nofollow" },
      ]),
    );
    expect(head.links).toContainEqual({
      rel: "canonical",
      href: "https://atlas.rebuildingamerica.com/claim/acme",
    });
  });

  it("invites the user to sign in when no session is present", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: null,
    } as unknown as ReturnType<typeof useAtlasSession>);

    const { router, Route } = await loadClaimRoute();
    router.useParams.mockReturnValue({ slug: "acme" });
    router.useSearch.mockReturnValue({
      atprotoHandle: "acme.bsky.social",
      atprotoIdentityId: "identity_1",
    });
    router.useLoaderData.mockReturnValue({
      entry: { id: "e1", name: "Acme", slug: "acme", type: "organization" },
    });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByText("Sign in to verify this profile")).toBeInTheDocument();
    expect(screen.getByText("Profile being verified")).toBeInTheDocument();
    const signInLink = screen.getByText("Sign in to continue");
    expect(signInLink).toHaveAttribute(
      "data-link-search",
      JSON.stringify({
        redirect: "/claim/acme?atprotoIdentityId=identity_1&atprotoHandle=acme.bsky.social",
      }),
    );
  });

  it("shows the verification CTA when a token is present and the claim is unverified", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: { user: { id: "u1" } },
    } as unknown as ReturnType<typeof useAtlasSession>);
    const verifyMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(claims.useVerifyClaimEmail).mockReturnValue({
      mutateAsync: verifyMock,
      isPending: false,
    } as unknown as ReturnType<typeof claims.useVerifyClaimEmail>);

    const { router, Route } = await loadClaimRoute();
    router.useParams.mockReturnValue({ slug: "acme" });
    router.useSearch.mockReturnValue({ token: "tok_123" });
    router.useLoaderData.mockReturnValue({
      entry: { id: "e1", name: "Acme", slug: "acme", type: "organization" },
    });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    const button = screen.getByRole("button", { name: "Confirm verification" });
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });
    expect(verifyMock).toHaveBeenCalledWith({ token: "tok_123" });
  });

  it("surfaces a verify error message when the verify mutation rejects", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: { user: { id: "u1" } },
    } as unknown as ReturnType<typeof useAtlasSession>);
    const verifyMock = vi.fn().mockRejectedValue(new Error("nope"));
    vi.mocked(claims.useVerifyClaimEmail).mockReturnValue({
      mutateAsync: verifyMock,
      isPending: false,
    } as unknown as ReturnType<typeof claims.useVerifyClaimEmail>);

    const { router, Route } = await loadClaimRoute();
    router.useParams.mockReturnValue({ slug: "acme" });
    router.useSearch.mockReturnValue({ token: "tok_123" });
    router.useLoaderData.mockReturnValue({
      entry: { id: "e1", name: "Acme", slug: "acme", type: "organization" },
    });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    const button = screen.getByRole("button", { name: "Confirm verification" });
    await act(async () => {
      fireEvent.click(button);
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("nope");
  });

  it("does nothing when handleVerify runs without a verification token in the search", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: { user: { id: "u1" } },
    } as unknown as ReturnType<typeof useAtlasSession>);
    const verifyMock = vi.fn();
    vi.mocked(claims.useVerifyClaimEmail).mockReturnValue({
      mutateAsync: verifyMock,
      isPending: false,
    } as unknown as ReturnType<typeof claims.useVerifyClaimEmail>);
    vi.mocked(claims.useMyClaims).mockReturnValue({
      data: [{ entry_id: "e1", status: "pending", tier: 1 }],
    } as unknown as ReturnType<typeof claims.useMyClaims>);

    const { router, Route } = await loadClaimRoute();
    router.useParams.mockReturnValue({ slug: "acme" });
    router.useSearch.mockReturnValue({});
    router.useLoaderData.mockReturnValue({
      entry: { id: "e1", name: "Acme", slug: "acme", type: "organization" },
    });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByText("Verification under review")).toBeInTheDocument();
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("renders the pending button copy while verify mutation is running", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: { user: { id: "u1" } },
    } as unknown as ReturnType<typeof useAtlasSession>);
    vi.mocked(claims.useVerifyClaimEmail).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: true,
    } as unknown as ReturnType<typeof claims.useVerifyClaimEmail>);
    vi.mocked(claims.useInitiateClaim).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    } as unknown as ReturnType<typeof claims.useInitiateClaim>);
    vi.mocked(claims.useMyClaims).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof claims.useMyClaims>);

    const { router, Route } = await loadClaimRoute();
    router.useParams.mockReturnValue({ slug: "acme" });
    router.useSearch.mockReturnValue({ token: "tok_x" });
    router.useLoaderData.mockReturnValue({
      entry: { id: "e1", name: "Acme", slug: "acme", type: "organization" },
    });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const view = render(<Component />);
    expect(view.getByRole("button", { name: "Verifying..." })).toBeDisabled();
  });

  it("uses the generic verify-failure copy when the rejection is not an Error", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: { user: { id: "u1" } },
    } as unknown as ReturnType<typeof useAtlasSession>);
    vi.mocked(claims.useVerifyClaimEmail).mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue("plain"),
      isPending: false,
    } as unknown as ReturnType<typeof claims.useVerifyClaimEmail>);
    vi.mocked(claims.useMyClaims).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof claims.useMyClaims>);

    const { router, Route } = await loadClaimRoute();
    router.useParams.mockReturnValue({ slug: "acme" });
    router.useSearch.mockReturnValue({ token: "tok_x" });
    router.useLoaderData.mockReturnValue({
      entry: { id: "e1", name: "Acme", slug: "acme", type: "organization" },
    });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm verification" }));
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Could not verify token.");
  });
});
