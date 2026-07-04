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

vi.mock("@/platform/ui/badge", () => ({
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
    expect(screen.getAllByText(/Detroit, MI/).length).toBeGreaterThan(0);
    expect(screen.getByText(/“first”/)).toBeInTheDocument();

    const removeButton = screen.getByLabelText("Remove Acme from list");
    fireEvent.click(removeButton);
    expect(removeMock).toHaveBeenCalledWith({ listId: "list-1", entryId: "e1" });
  });

  it("renders a saved list as a project-level research thread", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useSavedList).mockReturnValue({
      data: {
        id: "list-1",
        user_id: "user-1",
        name: "Tenant power map",
        description: "Actors, source leads, and next calls for the housing story.",
        item_count: 2,
        created_at: "2026-06-20T00:00:00.000Z",
        updated_at: "2026-06-24T00:00:00.000Z",
        items: [
          {
            entry_id: "e1",
            entry: {
              name: "KC Tenants",
              type: "organization",
              slug: "kc-tenants",
              photo_url: null,
              address: { city: "Kansas City", state: "MO" },
              source_count: 2,
            },
            note: "Ask about eviction court organizing.",
          },
          {
            entry_id: "e2",
            entry: {
              name: "Tenant Hotline",
              type: "initiative",
              slug: "tenant-hotline",
              photo_url: null,
              address: { city: null, state: "MO" },
              source_count: 1,
            },
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

    expect(screen.getByText("Research thread")).toBeInTheDocument();
    expect(screen.getByText("Project status")).toBeInTheDocument();
    expect(screen.getByText("Needs notes")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("Last updated")).toBeInTheDocument();
    expect(screen.getByText("Jun 24, 2026")).toBeInTheDocument();
    expect(screen.getByText("Brief")).toBeInTheDocument();
    expect(
      screen.getByText("Actors, source leads, and next calls for the housing story."),
    ).toBeInTheDocument();
    expect(screen.getByText("2 saved actors")).toBeInTheDocument();
    expect(screen.getAllByText("1 note").length).toBeGreaterThan(0);
    expect(screen.getByText("3 source packets")).toBeInTheDocument();
    expect(screen.getByText("Follow-up context")).toBeInTheDocument();
    expect(screen.getByText("Review latest source trail")).toBeInTheDocument();
    expect(screen.getByText("Add notes for unsorted leads")).toBeInTheDocument();
    const followUpTask = screen.getByRole("checkbox", { name: "Review latest source trail" });
    expect(followUpTask).not.toBeChecked();
    fireEvent.click(followUpTask);
    expect(followUpTask).toBeChecked();
  });

  it("renders a shareable evidence pack for a research thread", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: clipboardWriteText,
      },
    });
    vi.mocked(claims.useSavedList).mockReturnValue({
      data: {
        id: "list-1",
        name: "Tenant power map",
        description: "Actors and notes for the housing story.",
        item_count: 1,
        items: [
          {
            entry_id: "e1",
            entry: {
              name: "KC Tenants",
              type: "organization",
              slug: "kc-tenants",
              photo_url: null,
              address: { city: "Kansas City", state: "MO" },
              source_count: 2,
            },
            note: "Ask about eviction court organizing.",
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

    expect(screen.getByText("Evidence pack")).toBeInTheDocument();
    expect(screen.getByText("Shareable source summary")).toBeInTheDocument();
    expect(screen.getAllByText(/Tenant power map/).length).toBeGreaterThan(0);
    expect(screen.getByText(/KC Tenants — Kansas City, MO — 2 sources/)).toBeInTheDocument();
    expect(screen.getByText(/Note: Ask about eviction court organizing./)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy evidence pack" }));

    expect(clipboardWriteText).toHaveBeenCalledWith(
      expect.stringContaining("KC Tenants — Kansas City, MO — 2 sources"),
    );
  });

  it("copies a spreadsheet-friendly export for a research thread", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    const createObjectUrl = vi.fn().mockReturnValue("blob:atlas-list-export");
    const revokeObjectUrl = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    click.mockClear();
    const csvExport = [
      "list_id,list_name,entry_id,name,type,location,source_count,trust_level,source_urls,note,added_at,profile_slug",
      '"list-1","Tenant power map","e1","KC Tenants","organization","Kansas City, MO","2","unverified","https://example.org/kc-tenants","Ask about eviction court organizing.","2026-06-24T00:00:00.000Z","kc-tenants"',
    ].join("\n");
    const jsonExport = {
      format: "json",
      list: {
        id: "list-1",
        name: "Tenant power map",
        item_count: 1,
      },
      items: [
        {
          entry_id: "e1",
          note: "Ask about eviction court organizing.",
          trust_level: "unverified",
          sources: [
            {
              id: "source-1",
              url: "https://example.org/kc-tenants",
              title: "KC Tenants source",
              publication: "Metro Ledger",
              type: "news_article",
            },
          ],
          entry: {
            name: "KC Tenants",
            source_count: 2,
          },
        },
      ],
      provenance: {
        item_count: 1,
        source_count: 1,
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(csvExport),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(jsonExport),
      } as Response);
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });
    Object.assign(navigator, {
      clipboard: {
        writeText: clipboardWriteText,
      },
    });
    vi.mocked(claims.useSavedList).mockReturnValue({
      data: {
        id: "list-1",
        user_id: "user-1",
        name: "Tenant power map",
        description: "Actors and notes for the housing story.",
        item_count: 1,
        created_at: "2026-06-20T00:00:00.000Z",
        updated_at: "2026-06-24T00:00:00.000Z",
        items: [
          {
            list_id: "list-1",
            entry_id: "e1",
            added_at: "2026-06-24T00:00:00.000Z",
            entry: {
              name: "KC Tenants",
              type: "organization",
              slug: "kc-tenants",
              photo_url: null,
              address: { city: "Kansas City", state: "MO" },
              source_count: 2,
            },
            note: "Ask about eviction court organizing.",
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

    expect(screen.getByText("Spreadsheet export")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy CSV" }));

    expect(clipboardWriteText).toHaveBeenCalledWith(
      [
        "name,type,location,source_count,note",
        '"KC Tenants","organization","Kansas City, MO","2","Ask about eviction court organizing."',
      ].join("\n"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    await waitFor(() => {
      expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    });
    const csvBlob = createObjectUrl.mock.calls[0]?.[0] as Blob;
    await expect(csvBlob.text()).resolves.toContain("https://example.org/kc-tenants");
    await expect(csvBlob.text()).resolves.toContain('"unverified"');

    fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));
    await waitFor(() => {
      expect(createObjectUrl).toHaveBeenCalledTimes(2);
    });
    const jsonBlob = createObjectUrl.mock.calls[1]?.[0] as Blob;
    await expect(jsonBlob.text()).resolves.toContain('"name": "Tenant power map"');
    await expect(jsonBlob.text()).resolves.toContain('"url": "https://example.org/kc-tenants"');
    expect(fetchMock).toHaveBeenCalledWith("/api/lists/list-1/export?format=csv", {
      headers: { Accept: "text/csv" },
    });
    expect(click).toHaveBeenCalledTimes(2);
    expect(revokeObjectUrl).toHaveBeenLastCalledWith("blob:atlas-list-export");
  });

  it("copies institutional export and CRM handoff packets for team research workspaces", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const access = await import("@/domains/access");
    const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    const createObjectUrl = vi.fn().mockReturnValue("blob:atlas-team-list-export");
    const revokeObjectUrl = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    click.mockClear();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });
    Object.assign(navigator, {
      clipboard: {
        writeText: clipboardWriteText,
      },
    });
    vi.mocked(access.useAtlasSession).mockReturnValue({
      data: {
        workspace: {
          activeOrganization: {
            id: "org_1",
            name: "Metro Desk",
            workspaceType: "team",
          },
        },
      },
    } as unknown as ReturnType<typeof access.useAtlasSession>);
    vi.mocked(claims.useSavedList).mockReturnValue({
      data: {
        id: "list-1",
        user_id: "user-1",
        name: "Tenant power map",
        description: "Actors and notes for the housing story.",
        item_count: 1,
        created_at: "2026-06-20T00:00:00.000Z",
        updated_at: "2026-06-24T00:00:00.000Z",
        items: [
          {
            list_id: "list-1",
            entry_id: "e1",
            added_at: "2026-06-24T00:00:00.000Z",
            entry: {
              name: "KC Tenants",
              type: "organization",
              slug: "kc-tenants",
              photo_url: null,
              address: { city: "Kansas City", state: "MO" },
              source_count: 2,
            },
            note: "Ask about eviction court organizing.",
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

    expect(screen.getByText("Team research workspace")).toBeInTheDocument();
    expect(screen.getAllByText("Metro Desk").length).toBeGreaterThan(0);
    expect(screen.getByText("Institutional export")).toBeInTheDocument();
    expect(screen.getByText("CRM handoff")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy institutional CSV" }));
    expect(clipboardWriteText).toHaveBeenCalledWith(
      [
        "workspace,list,entry_id,name,type,location,source_count,note,crm_status,next_action",
        '"Metro Desk","Tenant power map","e1","KC Tenants","organization","Kansas City, MO","2","Ask about eviction court organizing.","ready_for_sync","Review latest source trail"',
      ].join("\n"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy CRM packet" }));
    expect(clipboardWriteText).toHaveBeenLastCalledWith(
      JSON.stringify(
        {
          workspace: "Metro Desk",
          list: "Tenant power map",
          leads: [
            {
              entryId: "e1",
              name: "KC Tenants",
              type: "organization",
              location: "Kansas City, MO",
              sourceCount: 2,
              note: "Ask about eviction court organizing.",
              syncStatus: "ready_for_sync",
              nextAction: "Review latest source trail",
            },
          ],
        },
        null,
        2,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Download institutional CSV" }));
    const institutionalBlob = createObjectUrl.mock.calls[0]?.[0] as Blob;
    await expect(institutionalBlob.text()).resolves.toContain(
      '"Metro Desk","Tenant power map","e1","KC Tenants"',
    );

    fireEvent.click(screen.getByRole("button", { name: "Download CRM JSON" }));
    const crmBlob = createObjectUrl.mock.calls[1]?.[0] as Blob;
    await expect(crmBlob.text()).resolves.toContain('"workspace": "Metro Desk"');
    await expect(crmBlob.text()).resolves.toContain('"syncStatus": "ready_for_sync"');
    expect(click).toHaveBeenCalledTimes(2);
    expect(revokeObjectUrl).toHaveBeenLastCalledWith("blob:atlas-team-list-export");
  });

  it("copies a nonprofit systems packet for adjacent advocacy and grant tools", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const access = await import("@/domains/access");
    const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: clipboardWriteText,
      },
    });
    vi.mocked(access.useAtlasSession).mockReturnValue({
      data: {
        workspace: {
          activeOrganization: {
            id: "org_1",
            name: "Housing Justice Coalition",
            workspaceType: "team",
          },
        },
      },
    } as unknown as ReturnType<typeof access.useAtlasSession>);
    vi.mocked(claims.useSavedList).mockReturnValue({
      data: {
        id: "list-1",
        user_id: "user-1",
        name: "Tenant power map",
        description: "Actors and notes for the housing story.",
        item_count: 1,
        created_at: "2026-06-20T00:00:00.000Z",
        updated_at: "2026-06-24T00:00:00.000Z",
        items: [
          {
            list_id: "list-1",
            entry_id: "e1",
            added_at: "2026-06-24T00:00:00.000Z",
            entry: {
              name: "KC Tenants",
              type: "organization",
              slug: "kc-tenants",
              photo_url: null,
              address: { city: "Kansas City", state: "MO" },
              source_count: 2,
            },
            note: "Ask about eviction court organizing.",
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

    expect(screen.getByRole("region", { name: "Nonprofit systems bridge" })).toBeInTheDocument();
    expect(screen.getByText("Advocacy CRM")).toBeInTheDocument();
    expect(screen.getByText("Grant diligence")).toBeInTheDocument();
    expect(screen.getByText("Coalition ops")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy systems packet" }));

    expect(clipboardWriteText).toHaveBeenCalledWith(
      [
        "Tenant power map nonprofit systems packet",
        "Workspace: Housing Justice Coalition",
        "Description: Actors and notes for the housing story.",
        "",
        "Actors: 1",
        "Sources: 2",
        "Notes: 1",
        "Ready for: Advocacy CRM, grant diligence, coalition ops",
        "",
        "KC Tenants — organization — Kansas City, MO — 2 sources",
        "Note: Ask about eviction court organizing.",
        "Next action: Review latest source trail",
      ].join("\n"),
    );
  });

  it("copies a newsroom assignment packet for editorial handoff", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: clipboardWriteText,
      },
    });
    vi.mocked(claims.useSavedList).mockReturnValue({
      data: {
        id: "list-1",
        user_id: "user-1",
        name: "Tenant power map",
        description: "Actors and notes for the housing story.",
        item_count: 1,
        created_at: "2026-06-20T00:00:00.000Z",
        updated_at: "2026-06-24T00:00:00.000Z",
        items: [
          {
            list_id: "list-1",
            entry_id: "e1",
            added_at: "2026-06-24T00:00:00.000Z",
            entry: {
              name: "KC Tenants",
              type: "organization",
              slug: "kc-tenants",
              photo_url: null,
              address: { city: "Kansas City", state: "MO" },
              source_count: 2,
            },
            note: "Ask about eviction court organizing.",
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

    expect(screen.getByRole("region", { name: "Newsroom handoff" })).toBeInTheDocument();
    expect(screen.getByText("Assignment packet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy assignment packet" }));

    expect(clipboardWriteText).toHaveBeenCalledWith(
      [
        "Tenant power map assignment packet",
        "Actors and notes for the housing story.",
        "",
        "Leads: 1",
        "Sources: 2",
        "Notes: 1",
        "Next action: Review latest source trail",
        "",
        "KC Tenants — Kansas City, MO — 2 sources",
        "Note: Ask about eviction court organizing.",
      ].join("\n"),
    );
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

    const routeModule = await import("@/routes/_workspace/lists.$id");
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
});
