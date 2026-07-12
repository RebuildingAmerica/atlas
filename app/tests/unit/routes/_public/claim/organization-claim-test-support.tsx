import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";

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

const clipboardMocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
}));

vi.mock("@/lib/clipboard", () => ({
  copyToClipboard: clipboardMocks.copyToClipboard,
}));

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/platform/ui/toast", () => ({
  useToast: () => toastMocks,
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
    disabled,
    onClick,
    variant: _variant,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    variant?: string;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

export async function setupOrganizationClaimTest() {
  await import("@tanstack/react-router");
  const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
  resetRouterMocks();
  const { useAtlasSession } = await import("@/domains/access");
  const { useAtprotoIdentities } = await import("@/domains/access/atproto-identities");
  const claims = await import("@/domains/catalog/hooks/use-claims");
  vi.mocked(useAtlasSession).mockReset();
  vi.mocked(useAtlasSession).mockReturnValue({
    data: { user: { id: "u1" } },
  } as unknown as ReturnType<typeof useAtlasSession>);
  vi.mocked(useAtprotoIdentities).mockReset();
  vi.mocked(useAtprotoIdentities).mockReturnValue({
    data: [],
    isError: false,
  } as unknown as ReturnType<typeof useAtprotoIdentities>);
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
  clipboardMocks.copyToClipboard.mockReset();
  clipboardMocks.copyToClipboard.mockResolvedValue(true);
  toastMocks.error.mockReset();
  toastMocks.success.mockReset();
}

export function cleanupOrganizationClaimTest() {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
}

export function cleanupRenderedOrganizationClaim() {
  cleanup();
}

export async function renderOrganizationClaim(search: Record<string, string> = {}) {
  const { useAtprotoIdentities } = await import("@/domains/access/atproto-identities");
  const identityId = search.atprotoIdentityId;
  vi.mocked(useAtprotoIdentities).mockReturnValue({
    data: identityId
      ? [
          {
            connected_at: "2026-07-12T12:00:00Z",
            control_status: "active",
            current_handle: search.atprotoHandle ?? "acme.org",
            did: "did:plc:acme",
            id: identityId,
            profiles: [],
            resolution_status:
              search.atprotoIdentityStatus === "needs_attention" ? "needs_attention" : "verified",
            verified_at: "2026-07-12T12:00:00Z",
          },
        ]
      : [],
    isError: false,
  } as unknown as ReturnType<typeof useAtprotoIdentities>);
  const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
  const router = readRouterMocks();
  router.useParams.mockReturnValue({ slug: "acme" });
  router.useSearch.mockReturnValue(search);
  router.useLoaderData.mockReturnValue({
    entry: { id: "e1", name: "Acme", slug: "acme", type: "organization" },
  });
  const routeModule = await import("@/routes/_public/claim/$slug");
  const Route = asRouteStub(routeModule.Route);
  const Component = Route.options.component;
  if (!Component) throw new Error("Expected Route.options.component");
  render(<Component />);
}

export async function mockInitiateClaim() {
  const claims = await import("@/domains/catalog/hooks/use-claims");
  const initiateMock = vi.fn().mockResolvedValue(undefined);
  vi.mocked(claims.useInitiateClaim).mockReturnValue({
    mutateAsync: initiateMock,
    isPending: false,
  } as unknown as ReturnType<typeof claims.useInitiateClaim>);
  return initiateMock;
}

export async function clickSubmitVerification() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Submit verification" }));
    await Promise.resolve();
  });
}

export { clipboardMocks, toastMocks };
