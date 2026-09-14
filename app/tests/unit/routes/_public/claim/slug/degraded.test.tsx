// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real `isNotFound` and `notFound` stay so the loader's degrade path can
// tell a missing record from an outage.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const harness = await import("@/../tests/helpers/router-harness");
  return { ...(await importOriginal<object>()), ...harness.installRouterMocks() };
});

vi.mock("@/domains/access", () => ({
  useAtlasSession: vi.fn(() => ({ data: null })),
}));

vi.mock("@/domains/access/atproto-identities", () => ({
  useAtprotoIdentities: vi.fn(() => ({ data: [], isError: false })),
}));

vi.mock("@/domains/catalog/hooks/use-claims", () => ({
  useInitiateClaim: vi.fn(() => ({ isPending: false, mutateAsync: vi.fn() })),
  useMyClaims: vi.fn(() => ({ data: [] })),
  useVerifyClaimDomain: vi.fn(() => ({ isPending: false, mutateAsync: vi.fn() })),
  useVerifyClaimEmail: vi.fn(() => ({ isPending: false, mutateAsync: vi.fn() })),
}));

vi.mock("@/domains/catalog/server/profiles/profile-loaders", () => ({
  loadEntryBySlugAny: vi.fn(),
}));

vi.mock("@rebuildingamerica/atlas-ui/layout/page-layout", () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/routes/_public/claim/-claim-components", () => ({
  ClaimContextRail: () => null,
  ClaimHero: ({ entry }: { entry: { name: string } }) => <h1>Verify {entry.name}</h1>,
  ClaimSubmissionPanel: () => null,
  PendingClaimPanel: () => null,
  SignedOutPanel: () => <p>Sign in to verify</p>,
  VerificationTokenPanel: () => null,
  VerifiedClaimPanel: () => null,
}));

describe("routes/_public/claim/$slug when the API is failing", () => {
  beforeEach(async () => {
    const { readRouterMocks, resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ slug: "acme" });
    router.useSearch.mockReturnValue({});
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the claim page without an entry instead of failing", async () => {
    const { loadEntryBySlugAny } =
      await import("@/domains/catalog/server/profiles/profile-loaders");
    vi.mocked(loadEntryBySlugAny).mockRejectedValue(
      Object.assign(new Error("Too many requests."), { status: 429 }),
    );

    const routeModule = await import("@/routes/_public/claim/$slug");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    await expect(Route.options.loader({ params: { slug: "acme" } })).resolves.toEqual({
      entry: undefined,
    });
  });

  it("still answers a slug that names nobody with not-found", async () => {
    const { notFound } = await import("@tanstack/react-router");
    const { loadEntryBySlugAny } =
      await import("@/domains/catalog/server/profiles/profile-loaders");
    const missing = notFound();
    vi.mocked(loadEntryBySlugAny).mockRejectedValue(missing);

    const routeModule = await import("@/routes/_public/claim/$slug");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    await expect(Route.options.loader({ params: { slug: "acme" } })).rejects.toBe(missing);
  });

  it("holds the claim page's frame until the browser fetches the entry", async () => {
    const { loadEntryBySlugAny } =
      await import("@/domains/catalog/server/profiles/profile-loaders");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const { renderWithProviders } = await import("@/../tests/helpers/render-with-providers");
    let deliver: ((entry: Awaited<ReturnType<typeof loadEntryBySlugAny>>) => void) | undefined;
    vi.mocked(loadEntryBySlugAny).mockImplementation(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    readRouterMocks().useLoaderData.mockReturnValue({ entry: undefined });

    const routeModule = await import("@/routes/_public/claim/$slug");
    const Component = asRouteStub(routeModule.Route).options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    renderWithProviders(<Component />);

    expect(screen.getByTestId("claim-page-placeholder")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading profile");
    expect(screen.queryByText("Sign in to verify")).toBeNull();
    expect(loadEntryBySlugAny).toHaveBeenCalledWith({ data: { slug: "acme" } });

    await act(async () => {
      deliver?.({ id: "entry-1", name: "Acme", slug: "acme", type: "organization" } as Awaited<
        ReturnType<typeof loadEntryBySlugAny>
      >);
      await Promise.resolve();
    });

    expect(await screen.findByRole("heading", { name: "Verify Acme" })).toBeInTheDocument();
    expect(screen.getByText("Sign in to verify")).toBeInTheDocument();
    expect(screen.queryByTestId("claim-page-placeholder")).toBeNull();
  });
});
