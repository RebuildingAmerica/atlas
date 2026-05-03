// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/catalog/hooks/use-claims", () => ({
  useRemoveSavedListItem: vi.fn(),
  useSavedList: vi.fn(),
}));

vi.mock("@/domains/catalog/components/profiles/actor-avatar", () => ({
  ActorAvatar: ({ name }: { name: string }) => <span data-testid="actor-avatar">{name}</span>,
}));

vi.mock("@/platform/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

describe("routes/_workspace/lists/$id", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useRemoveSavedListItem).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof claims.useRemoveSavedListItem>);
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the loading copy while the list query is in flight", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useSavedList).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof claims.useSavedList>);

    const routeModule = await import("@/routes/_workspace/lists.$id");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ id: "list-1" });
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByText(/Loading list…/)).toBeInTheDocument();
  });

  it("shows the not-found copy when the list cannot be loaded", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useSavedList).mockReturnValue({
      data: null,
      isLoading: false,
    } as unknown as ReturnType<typeof claims.useSavedList>);

    const routeModule = await import("@/routes/_workspace/lists.$id");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ id: "list-1" });
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByText("List not found")).toBeInTheDocument();
  });

  it("shows the no-actors copy when items is undefined or empty", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useSavedList).mockReturnValueOnce({
      data: { id: "list-1", name: "Outreach", description: null, item_count: 0, items: undefined },
      isLoading: false,
    } as unknown as ReturnType<typeof claims.useSavedList>);

    const routeModule = await import("@/routes/_workspace/lists.$id");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ id: "list-1" });
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByText("No actors yet.")).toBeInTheDocument();
  });

  it("renders actors with mixed metadata and removes them via the trash button", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const removeMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(claims.useRemoveSavedListItem).mockReturnValue({
      mutateAsync: removeMock,
    } as unknown as ReturnType<typeof claims.useRemoveSavedListItem>);
    vi.mocked(claims.useSavedList).mockReturnValue({
      data: {
        id: "list-1",
        name: "Outreach",
        description: "All sorts",
        item_count: 3,
        items: [
          {
            entry_id: "e1",
            entry: {
              name: "Acme",
              type: "organization",
              slug: "acme",
              photo_url: "https://img.test/a.png",
              address: { city: "Detroit", state: "MI" },
              source_count: 1,
            },
            note: "first",
          },
          {
            entry_id: "e2",
            entry: {
              name: "Jane",
              type: "person",
              slug: "",
              photo_url: null,
              address: { city: null, state: "CA" },
              source_count: undefined,
            },
            note: null,
          },
          {
            entry_id: "e3",
            entry: null,
            note: null,
          },
        ],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof claims.useSavedList>);

    const routeModule = await import("@/routes/_workspace/lists.$id");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ id: "list-1" });
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getAllByText("Acme").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Jane").length).toBeGreaterThan(0);
    expect(screen.getByText("Profile unavailable")).toBeInTheDocument();
    expect(screen.getByText(/Detroit, MI/)).toBeInTheDocument();
    expect(screen.getByText(/“first”/)).toBeInTheDocument();

    const removeButton = screen.getByLabelText("Remove Acme from list");
    fireEvent.click(removeButton);
    expect(removeMock).toHaveBeenCalledWith({ listId: "list-1", entryId: "e1" });
  });
});
