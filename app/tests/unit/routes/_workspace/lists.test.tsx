// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/catalog/hooks/use-claims", () => ({
  useCreateSavedList: vi.fn(),
  useDeleteSavedList: vi.fn(),
  useSavedLists: vi.fn(),
}));

vi.mock("@/domains/access", () => ({
  useAtlasSession: vi.fn(),
}));

vi.mock("@rebuildingamerica/atlas-ui/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@rebuildingamerica/atlas-ui/ui/button", () => ({
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

describe("routes/_workspace/lists", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const access = await import("@/domains/access");
    vi.mocked(access.useAtlasSession).mockReturnValue({ data: null } as unknown as ReturnType<
      typeof access.useAtlasSession
    >);
    vi.mocked(claims.useCreateSavedList).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    } as unknown as ReturnType<typeof claims.useCreateSavedList>);
    vi.mocked(claims.useDeleteSavedList).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof claims.useDeleteSavedList>);
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the loading state while saved lists are being fetched", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useSavedLists).mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof claims.useSavedLists>);

    const routeModule = await import("@/routes/_workspace/lists");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByText(/Loading lists…/)).toBeInTheDocument();
  });

  it("shows the empty state when there are no saved lists", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useSavedLists).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof claims.useSavedLists>);

    const routeModule = await import("@/routes/_workspace/lists");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByText(/You haven't built any lists yet/)).toBeInTheDocument();
  });

  it("falls back to the empty-state copy when useSavedLists returns undefined data", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useSavedLists).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as unknown as ReturnType<typeof claims.useSavedLists>);

    const routeModule = await import("@/routes/_workspace/lists");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByText(/You haven't built any lists yet/)).toBeInTheDocument();
  });

  it("creates a saved list with the trimmed name and description", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const createMutation = vi.fn().mockResolvedValue(undefined);
    vi.mocked(claims.useCreateSavedList).mockReturnValue({
      mutateAsync: createMutation,
      isPending: false,
    } as unknown as ReturnType<typeof claims.useCreateSavedList>);
    vi.mocked(claims.useSavedLists).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof claims.useSavedLists>);

    const routeModule = await import("@/routes/_workspace/lists");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: /New list/ }));
    fireEvent.change(screen.getByPlaceholderText("List name"), {
      target: { value: "  Outreach  " },
    });
    fireEvent.change(screen.getByPlaceholderText("Optional description"), {
      target: { value: "  Notes  " },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Create list/ }));
      await Promise.resolve();
    });

    expect(createMutation).toHaveBeenCalledWith({ name: "Outreach", description: "Notes" });
  });

  it("does nothing when create is invoked with a blank name", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const createMutation = vi.fn().mockResolvedValue(undefined);
    vi.mocked(claims.useCreateSavedList).mockReturnValue({
      mutateAsync: createMutation,
      isPending: false,
    } as unknown as ReturnType<typeof claims.useCreateSavedList>);
    vi.mocked(claims.useSavedLists).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof claims.useSavedLists>);

    const routeModule = await import("@/routes/_workspace/lists");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: /New list/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Create list/ }));
      await Promise.resolve();
    });
    expect(createMutation).not.toHaveBeenCalled();
  });

  it("surfaces a create error message and persists null description for empty input", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const createMutation = vi.fn().mockRejectedValue(new Error("boom"));
    vi.mocked(claims.useCreateSavedList).mockReturnValue({
      mutateAsync: createMutation,
      isPending: false,
    } as unknown as ReturnType<typeof claims.useCreateSavedList>);
    vi.mocked(claims.useSavedLists).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof claims.useSavedLists>);

    const routeModule = await import("@/routes/_workspace/lists");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: /New list/ }));
    fireEvent.change(screen.getByPlaceholderText("List name"), { target: { value: "Outreach" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Create list/ }));
      await Promise.resolve();
    });
    expect(createMutation).toHaveBeenCalledWith({ name: "Outreach", description: null });
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });

  it("uses the generic create-error fallback when the rejection is not an Error", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const createMutation = vi.fn().mockRejectedValue("string-fail");
    vi.mocked(claims.useCreateSavedList).mockReturnValue({
      mutateAsync: createMutation,
      isPending: false,
    } as unknown as ReturnType<typeof claims.useCreateSavedList>);
    vi.mocked(claims.useSavedLists).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof claims.useSavedLists>);

    const routeModule = await import("@/routes/_workspace/lists");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: /New list/ }));
    fireEvent.change(screen.getByPlaceholderText("List name"), { target: { value: "Outreach" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Create list/ }));
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Could not create list.");
  });

  it("hides the create panel when cancel is clicked", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useSavedLists).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof claims.useSavedLists>);

    const routeModule = await import("@/routes/_workspace/lists");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: /New list/ }));
    expect(screen.getByPlaceholderText("List name")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByPlaceholderText("List name")).not.toBeInTheDocument();
  });

  it("renders saved lists with the singular/plural counter and the description block", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const deleteMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(claims.useDeleteSavedList).mockReturnValue({
      mutateAsync: deleteMock,
    } as unknown as ReturnType<typeof claims.useDeleteSavedList>);
    vi.mocked(claims.useSavedLists).mockReturnValue({
      data: [
        { id: "list-1", name: "Outreach", description: "stuff", item_count: 1 },
        { id: "list-2", name: "Coalition", description: null, item_count: 3 },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof claims.useSavedLists>);

    const routeModule = await import("@/routes/_workspace/lists");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByText("Project workspaces")).toBeInTheDocument();
    expect(screen.getAllByText("Leads, notes, briefs, and exports")).toHaveLength(2);
    expect(screen.getByText("Outreach")).toBeInTheDocument();
    expect(screen.getByText("Coalition")).toBeInTheDocument();
    expect(screen.getByText("1 actor")).toBeInTheDocument();
    expect(screen.getByText("3 actors")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Delete Outreach"));
    expect(deleteMock).toHaveBeenCalledWith("list-1");
  });

  it("surfaces team collaboration context for shared project workspaces", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const access = await import("@/domains/access");
    vi.mocked(access.useAtlasSession).mockReturnValue({
      data: {
        workspace: {
          activeOrganization: {
            id: "org_1",
            name: "Atlas Team",
            workspaceType: "team",
          },
        },
      },
    } as unknown as ReturnType<typeof access.useAtlasSession>);
    vi.mocked(claims.useSavedLists).mockReturnValue({
      data: [{ id: "list-1", name: "Outreach", description: "stuff", item_count: 1 }],
      isLoading: false,
    } as unknown as ReturnType<typeof claims.useSavedLists>);

    const routeModule = await import("@/routes/_workspace/lists");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    expect(screen.getByText("Shared project workspaces")).toBeInTheDocument();
    expect(screen.getByText("Shared project workspace")).toBeInTheDocument();
    expect(screen.getByText("Team-visible notes")).toBeInTheDocument();
    expect(screen.getByText("Owner: Atlas Team")).toBeInTheDocument();
    expect(screen.getByText("Activity: leads, notes, and exports")).toBeInTheDocument();
  });
});
