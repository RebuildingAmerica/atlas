// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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

describe("routes/_workspace/lists/$id packet exports", () => {
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

    const routeModule = await import("@/routes/_workspace/lists/$id");
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

    const routeModule = await import("@/routes/_workspace/lists/$id");
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

    const routeModule = await import("@/routes/_workspace/lists/$id");
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
});
