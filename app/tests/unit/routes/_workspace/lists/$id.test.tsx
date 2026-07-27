// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/catalog/hooks/use-claims", () => ({
  useAddSavedListItem: vi.fn(),
  useRemoveSavedListItem: vi.fn(),
  useSavedList: vi.fn(),
}));

vi.mock("@/domains/catalog/components/profiles/actor-avatar", () => ({
  ActorAvatar: ({ name }: { name: string }) => <span data-testid="actor-avatar">{name}</span>,
}));

vi.mock("@/domains/access", () => ({
  useAtlasSession: vi.fn(),
}));

vi.mock("@rebuildingamerica/atlas-ui/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

describe("routes/_workspace/lists/$id", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const access = await import("@/domains/access");
    vi.mocked(access.useAtlasSession).mockReturnValue({ data: null } as unknown as ReturnType<
      typeof access.useAtlasSession
    >);
    vi.mocked(claims.useAddSavedListItem).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    } as unknown as ReturnType<typeof claims.useAddSavedListItem>);
    vi.mocked(claims.useRemoveSavedListItem).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof claims.useRemoveSavedListItem>);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the loading copy while the list query is in flight", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useSavedList).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof claims.useSavedList>);

    const routeModule = await import("@/routes/_workspace/lists/$id");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ id: "list-1" });
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByText(/Loading list…/)).toBeInTheDocument();
  }, 60_000);

  it("shows the not-found copy when the list cannot be loaded", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useSavedList).mockReturnValue({
      data: null,
      isLoading: false,
    } as unknown as ReturnType<typeof claims.useSavedList>);

    const routeModule = await import("@/routes/_workspace/lists/$id");
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

    const routeModule = await import("@/routes/_workspace/lists/$id");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ id: "list-1" });
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByText("No people or groups yet.")).toBeInTheDocument();
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

    const routeModule = await import("@/routes/_workspace/lists/$id");
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
    expect(screen.getAllByText(/Detroit, MI/).length).toBeGreaterThan(0);
    expect(screen.getByText(/“first”/)).toBeInTheDocument();

    const removeButton = screen.getByLabelText("Remove Acme from list");
    fireEvent.click(removeButton);
    expect(removeMock).toHaveBeenCalledWith({ listId: "list-1", entryId: "e1" });
  });

  it("names an actor whose record lost its name so the row is still readable", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useSavedList).mockReturnValue({
      data: {
        id: "list-1",
        name: "Outreach",
        description: null,
        item_count: 1,
        items: [
          {
            entry_id: "e1",
            entry: {
              name: null,
              type: "organization",
              slug: "",
              photo_url: null,
              address: { city: null, state: null },
              source_count: 1,
            },
            note: null,
          },
        ],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof claims.useSavedList>);

    const routeModule = await import("@/routes/_workspace/lists/$id");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    readRouterMocks().useParams.mockReturnValue({ id: "list-1" });
    const Component = asRouteStub(routeModule.Route).options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    expect(screen.getByTestId("actor-avatar")).toHaveTextContent("Profile unavailable");
    expect(screen.getAllByText("Profile unavailable").length).toBeGreaterThan(0);
  });

  it("saves an inline note for a saved actor", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const saveNoteMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(claims.useAddSavedListItem).mockReturnValue({
      mutateAsync: saveNoteMock,
      isPending: false,
    } as unknown as ReturnType<typeof claims.useAddSavedListItem>);
    vi.mocked(claims.useSavedList).mockReturnValue({
      data: {
        id: "list-1",
        name: "Outreach",
        description: null,
        item_count: 1,
        items: [
          {
            entry_id: "e1",
            entry: {
              name: "Acme",
              type: "organization",
              slug: "acme",
              photo_url: null,
              address: { city: "Detroit", state: "MI" },
              source_count: 1,
            },
            note: null,
          },
        ],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof claims.useSavedList>);

    const routeModule = await import("@/routes/_workspace/lists/$id");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ id: "list-1" });
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: "Add note for Acme" }));
    fireEvent.change(screen.getByLabelText("Note for Acme"), {
      target: { value: "Call before Friday." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note for Acme" }));

    await waitFor(() => {
      expect(saveNoteMock).toHaveBeenCalledWith({
        listId: "list-1",
        body: { entry_id: "e1", note: "Call before Friday." },
      });
    });
  });

  it("clears a note when the researcher empties the draft", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const saveNoteMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(claims.useAddSavedListItem).mockReturnValue({
      mutateAsync: saveNoteMock,
      isPending: false,
    } as unknown as ReturnType<typeof claims.useAddSavedListItem>);
    vi.mocked(claims.useSavedList).mockReturnValue({
      data: {
        id: "list-1",
        name: "Outreach",
        description: null,
        item_count: 1,
        items: [
          {
            entry_id: "e1",
            entry: {
              name: "Acme",
              type: "organization",
              slug: "acme",
              photo_url: null,
              address: { city: "Detroit", state: "MI" },
              source_count: 1,
            },
            note: "Call before Friday.",
          },
        ],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof claims.useSavedList>);

    const routeModule = await import("@/routes/_workspace/lists/$id");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    readRouterMocks().useParams.mockReturnValue({ id: "list-1" });
    const Component = asRouteStub(routeModule.Route).options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: "Edit note for Acme" }));
    fireEvent.change(screen.getByLabelText("Note for Acme"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save note for Acme" }));

    await waitFor(() => {
      expect(saveNoteMock).toHaveBeenCalledWith({
        listId: "list-1",
        body: { entry_id: "e1", note: null },
      });
    });
  });

  it("keeps the note editor open and says so when the save fails", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useAddSavedListItem).mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(new Error("network down")),
      isPending: false,
    } as unknown as ReturnType<typeof claims.useAddSavedListItem>);
    vi.mocked(claims.useSavedList).mockReturnValue({
      data: {
        id: "list-1",
        name: "Outreach",
        description: null,
        item_count: 1,
        items: [
          {
            entry_id: "e1",
            entry: {
              name: "Acme",
              type: "organization",
              slug: "acme",
              photo_url: null,
              address: { city: "Detroit", state: "MI" },
              source_count: 1,
            },
            note: null,
          },
        ],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof claims.useSavedList>);

    const routeModule = await import("@/routes/_workspace/lists/$id");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    readRouterMocks().useParams.mockReturnValue({ id: "list-1" });
    const Component = asRouteStub(routeModule.Route).options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: "Add note for Acme" }));
    fireEvent.change(screen.getByLabelText("Note for Acme"), {
      target: { value: "Call before Friday." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note for Acme" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save note.");
    expect(screen.getByLabelText("Note for Acme")).toHaveValue("Call before Friday.");
    expect(screen.queryByText("network down")).toBeNull();
  });
});
