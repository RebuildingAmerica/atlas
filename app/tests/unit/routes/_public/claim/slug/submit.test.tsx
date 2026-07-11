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

describe("routes/_public/claim/$slug submission", () => {
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

    const { router, Route } = await loadClaimRoute();
    router.useParams.mockReturnValue({ slug: "jane" });
    const entry = { id: "e2", name: "Jane", slug: "jane", type: "person" };

    vi.mocked(claims.useMyClaims).mockReturnValueOnce({
      data: [{ entry_id: "e2", status: "verified", tier: 1 }],
    } as unknown as ReturnType<typeof claims.useMyClaims>);
    router.useSearch.mockReturnValue({});
    router.useLoaderData.mockReturnValue({ entry });
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");

    const verifiedView = render(<Component />);
    expect(verifiedView.getByText("View public profile")).toBeInTheDocument();
    verifiedView.unmount();

    vi.mocked(claims.useMyClaims).mockReturnValueOnce({
      data: [{ entry_id: "e2", status: "pending", tier: 1 }],
    } as unknown as ReturnType<typeof claims.useMyClaims>);
    const pendingView = render(<Component />);
    expect(pendingView.getByText("Verification under review")).toBeInTheDocument();
    expect(pendingView.getByText("Check your email to finish verification.")).toBeInTheDocument();
    pendingView.unmount();

    vi.mocked(claims.useMyClaims).mockReturnValueOnce({
      data: [],
    } as unknown as ReturnType<typeof claims.useMyClaims>);
    const submitView = render(<Component />);
    expect(submitView.getByText("Profile verification")).toBeInTheDocument();
    expect(submitView.getByText("Show your connection")).toBeInTheDocument();
    expect(submitView.getByText("Suggest profile updates")).toBeInTheDocument();
    expect(submitView.getByText("Private context")).toBeInTheDocument();
    expect(submitView.getByText("Profile being verified")).toBeInTheDocument();
    expect(submitView.getByText("What happens next")).toBeInTheDocument();
    expect(submitView.getByText("What should change?")).toBeInTheDocument();
    expect(submitView.getByText("Visible after verification")).toBeInTheDocument();
    fireEvent.change(submitView.getByLabelText("Your relationship to this profile"), {
      target: { value: "self" },
    });
    fireEvent.change(submitView.getByRole("textbox", { name: "Source for your connection" }), {
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
    const submitButton = submitView.getByRole("button", { name: "Submit verification" });
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

    const { router, Route } = await loadClaimRoute();
    router.useParams.mockReturnValue({ slug: "ent" });
    router.useSearch.mockReturnValue({});
    router.useLoaderData.mockReturnValue({
      entry: { id: "e3", name: "Ent", slug: "ent", type: "person" },
    });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByText("A reviewer is checking the connection.")).toBeInTheDocument();
  });

  it("renders the pending button copy while initiate mutation is running", async () => {
    const { useAtlasSession } = await import("@/domains/access");
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(useAtlasSession).mockReturnValue({
      data: { user: { id: "u1" } },
    } as unknown as ReturnType<typeof useAtlasSession>);
    vi.mocked(claims.useVerifyClaimEmail).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    } as unknown as ReturnType<typeof claims.useVerifyClaimEmail>);
    vi.mocked(claims.useInitiateClaim).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: true,
    } as unknown as ReturnType<typeof claims.useInitiateClaim>);
    vi.mocked(claims.useMyClaims).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof claims.useMyClaims>);

    const { router, Route } = await loadClaimRoute();
    router.useParams.mockReturnValue({ slug: "acme" });
    router.useSearch.mockReturnValue({});
    router.useLoaderData.mockReturnValue({
      entry: { id: "e1", name: "Acme", slug: "acme", type: "organization" },
    });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const view = render(<Component />);
    expect(view.getByRole("button", { name: "Submitting..." })).toBeDisabled();
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

    const { router, Route } = await loadClaimRoute();
    router.useParams.mockReturnValue({ slug: "acme" });
    router.useSearch.mockReturnValue({});
    router.useLoaderData.mockReturnValue({
      entry: { id: "e1", name: "Acme", slug: "acme", type: "organization" },
    });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit verification" }));
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Could not start verification.");
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

    const { router, Route } = await loadClaimRoute();
    router.useParams.mockReturnValue({ slug: "acme" });
    router.useSearch.mockReturnValue({});
    router.useLoaderData.mockReturnValue({
      entry: { id: "e1", name: "Acme", slug: "acme", type: "organization" },
    });

    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit verification" }));
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("bad");
  });
});
