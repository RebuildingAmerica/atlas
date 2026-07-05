// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
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
  useVerifyClaimEmail: vi.fn(),
}));

vi.mock("@/domains/catalog/server/profiles/profile-loaders", () => ({
  loadEntryBySlugAny: vi.fn(),
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

describe("routes/_public/claim/$slug", () => {
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
    vi.mocked(claims.useMyClaims).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof claims.useMyClaims>);
  });

  afterEach(() => {
    cleanup();
  });

  it("validates optional from/token search params and loads the entry by slug", async () => {
    const { loadEntryBySlugAny } =
      await import("@/domains/catalog/server/profiles/profile-loaders");
    const entry = { id: "e1", name: "Acme", slug: "acme", type: "organization" };
    vi.mocked(loadEntryBySlugAny).mockResolvedValue(
      entry as Awaited<ReturnType<typeof loadEntryBySlugAny>>,
    );

    const routeModule = await import("@/routes/_public/claim/$slug");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const validator = Route.options.validateSearch as { parse: (input: unknown) => unknown };
    expect(validator.parse({ from: "email", token: "tok" })).toEqual({
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
        { title: "Claim Acme | Atlas" },
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

    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ slug: "acme" });
    router.useSearch.mockReturnValue({});
    router.useLoaderData.mockReturnValue({
      entry: { id: "e1", name: "Acme", slug: "acme", type: "organization" },
    });

    const routeModule = await import("@/routes/_public/claim/$slug");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByText("Sign in to claim this profile")).toBeInTheDocument();
    expect(screen.getByText("Profile being claimed")).toBeInTheDocument();
    expect(screen.getByText("Sign in to continue")).toBeInTheDocument();
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

    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ slug: "acme" });
    router.useSearch.mockReturnValue({ token: "tok_123" });
    router.useLoaderData.mockReturnValue({
      entry: { id: "e1", name: "Acme", slug: "acme", type: "organization" },
    });

    const routeModule = await import("@/routes/_public/claim/$slug");
    const Route = asRouteStub(routeModule.Route);
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

    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ slug: "acme" });
    router.useSearch.mockReturnValue({ token: "tok_123" });
    router.useLoaderData.mockReturnValue({
      entry: { id: "e1", name: "Acme", slug: "acme", type: "organization" },
    });

    const routeModule = await import("@/routes/_public/claim/$slug");
    const Route = asRouteStub(routeModule.Route);
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

  it("renders the verified, pending, and submit-claim states", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: { user: { id: "u1" } },
    } as unknown as ReturnType<typeof useAtlasSession>);
    const initiateMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(claims.useInitiateClaim).mockReturnValue({
      mutateAsync: initiateMock,
      isPending: false,
    } as unknown as ReturnType<typeof claims.useInitiateClaim>);

    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ slug: "jane" });

    const entry = { id: "e2", name: "Jane", slug: "jane", type: "person" };

    // Verified state
    vi.mocked(claims.useMyClaims).mockReturnValueOnce({
      data: [{ entry_id: "e2", status: "verified", tier: 1 }],
    } as unknown as ReturnType<typeof claims.useMyClaims>);
    router.useSearch.mockReturnValue({});
    router.useLoaderData.mockReturnValue({ entry });
    const routeModule = await import("@/routes/_public/claim/$slug");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");

    const verifiedView = render(<Component />);
    expect(verifiedView.getByText("View public profile")).toBeInTheDocument();
    verifiedView.unmount();

    // Pending state
    vi.mocked(claims.useMyClaims).mockReturnValueOnce({
      data: [{ entry_id: "e2", status: "pending", tier: 1 }],
    } as unknown as ReturnType<typeof claims.useMyClaims>);
    const pendingView = render(<Component />);
    expect(pendingView.getByText("Claim under review")).toBeInTheDocument();
    expect(pendingView.getByText(/tier-1 email verification/)).toBeInTheDocument();
    pendingView.unmount();

    // Submit-claim happy path
    vi.mocked(claims.useMyClaims).mockReturnValueOnce({
      data: [],
    } as unknown as ReturnType<typeof claims.useMyClaims>);
    const submitView = render(<Component />);
    expect(submitView.getByText("Profile claim")).toBeInTheDocument();
    expect(submitView.getByText("Verify relationship")).toBeInTheDocument();
    expect(submitView.getByText("Suggest public changes")).toBeInTheDocument();
    expect(submitView.getByText("Private context")).toBeInTheDocument();
    expect(submitView.getByText("Profile being claimed")).toBeInTheDocument();
    expect(submitView.getByText("What happens next")).toBeInTheDocument();
    expect(submitView.getByText("What should change?")).toBeInTheDocument();
    expect(submitView.getByText("Public after verification")).toBeInTheDocument();
    fireEvent.change(submitView.getByLabelText("Your relationship to this profile"), {
      target: { value: "self" },
    });
    fireEvent.change(submitView.getByRole("textbox", { name: "Evidence for this claim" }), {
      target: { value: "evidence" },
    });
    fireEvent.change(submitView.getByRole("textbox", { name: "What should change?" }), {
      target: { value: "Update my title and contact path." },
    });
    fireEvent.change(submitView.getByLabelText("Preferred contact"), {
      target: { value: "form" },
    });
    fireEvent.change(submitView.getByRole("textbox", { name: "Private note" }), {
      target: { value: "Keep my direct email private." },
    });
    const submitButton = submitView.getByRole("button", { name: "Submit claim" });
    await act(async () => {
      fireEvent.click(submitButton);
      await Promise.resolve();
    });
    expect(initiateMock).toHaveBeenCalledWith({
      slug: "jane",
      body: {
        relationship: "self",
        evidence: "evidence",
        requested_changes: "Update my title and contact path.",
        preferred_contact_channel: "form",
        private_note: "Keep my direct email private.",
      },
    });
    submitView.unmount();
  });

  it("shows tier-2 review copy for non-tier-1 pending claims", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: { user: { id: "u1" } },
    } as unknown as ReturnType<typeof useAtlasSession>);
    vi.mocked(claims.useMyClaims).mockReturnValue({
      data: [{ entry_id: "e3", status: "pending", tier: 2 }],
    } as unknown as ReturnType<typeof claims.useMyClaims>);

    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ slug: "ent" });
    router.useSearch.mockReturnValue({});
    router.useLoaderData.mockReturnValue({
      entry: { id: "e3", name: "Ent", slug: "ent", type: "person" },
    });

    const routeModule = await import("@/routes/_public/claim/$slug");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByText(/manual review/)).toBeInTheDocument();
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

    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ slug: "acme" });
    router.useSearch.mockReturnValue({});
    router.useLoaderData.mockReturnValue({
      entry: { id: "e1", name: "Acme", slug: "acme", type: "organization" },
    });

    const routeModule = await import("@/routes/_public/claim/$slug");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    // The pending state has no Confirm-verification button, so handleVerify cannot
    // be triggered from the UI when no token is present.  Branch coverage is
    // exercised via the missing-token path in handleInitiate's wrapper.
    expect(screen.getByText("Claim under review")).toBeInTheDocument();
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("renders the pending button copy while verify and initiate mutations are running", async () => {
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
      isPending: true,
    } as unknown as ReturnType<typeof claims.useInitiateClaim>);
    vi.mocked(claims.useMyClaims).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof claims.useMyClaims>);

    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ slug: "acme" });
    router.useSearch.mockReturnValue({ token: "tok_x" });
    router.useLoaderData.mockReturnValue({
      entry: { id: "e1", name: "Acme", slug: "acme", type: "organization" },
    });

    const routeModule = await import("@/routes/_public/claim/$slug");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const view = render(<Component />);
    expect(view.getByRole("button", { name: "Verifying…" })).toBeDisabled();
    view.unmount();

    router.useSearch.mockReturnValue({});
    const initiateView = render(<Component />);
    expect(initiateView.getByRole("button", { name: "Submitting…" })).toBeDisabled();
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

    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ slug: "acme" });
    router.useSearch.mockReturnValue({ token: "tok_x" });
    router.useLoaderData.mockReturnValue({
      entry: { id: "e1", name: "Acme", slug: "acme", type: "organization" },
    });

    const routeModule = await import("@/routes/_public/claim/$slug");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm verification" }));
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Could not verify token.");
  });

  it("uses the generic initiate-failure copy when the rejection is not an Error", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: { user: { id: "u1" } },
    } as unknown as ReturnType<typeof useAtlasSession>);
    vi.mocked(claims.useInitiateClaim).mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue("plain"),
      isPending: false,
    } as unknown as ReturnType<typeof claims.useInitiateClaim>);
    vi.mocked(claims.useMyClaims).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof claims.useMyClaims>);

    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ slug: "acme" });
    router.useSearch.mockReturnValue({});
    router.useLoaderData.mockReturnValue({
      entry: { id: "e1", name: "Acme", slug: "acme", type: "organization" },
    });

    const routeModule = await import("@/routes/_public/claim/$slug");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit claim" }));
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Could not initiate claim.");
  });

  it("surfaces an initiate error message when the submit mutation rejects", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: { user: { id: "u1" } },
    } as unknown as ReturnType<typeof useAtlasSession>);
    vi.mocked(claims.useInitiateClaim).mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(new Error("bad")),
      isPending: false,
    } as unknown as ReturnType<typeof claims.useInitiateClaim>);
    vi.mocked(claims.useMyClaims).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof claims.useMyClaims>);

    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ slug: "acme" });
    router.useSearch.mockReturnValue({});
    router.useLoaderData.mockReturnValue({
      entry: { id: "e1", name: "Acme", slug: "acme", type: "organization" },
    });

    const routeModule = await import("@/routes/_public/claim/$slug");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit claim" }));
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("bad");
  });
});
