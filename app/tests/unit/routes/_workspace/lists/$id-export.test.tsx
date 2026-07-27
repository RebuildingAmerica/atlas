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

describe("routes/_workspace/lists/$id export cases", () => {
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

    const routeModule = await import("@/routes/_workspace/lists/$id");
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
    fireEvent.click(followUpTask);
    expect(followUpTask).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Add notes for unsorted leads" }),
    ).not.toBeChecked();
  }, 60_000);

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

    const routeModule = await import("@/routes/_workspace/lists/$id");
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

  it("does not hand the researcher a file when the CSV export request fails", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const createObjectUrl = vi.fn().mockReturnValue("blob:atlas-list-export");
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, text: () => "" });
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    vi.mocked(claims.useSavedList).mockReturnValue({
      data: {
        id: "list-1",
        name: "Tenant power map",
        description: null,
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

    const routeModule = await import("@/routes/_workspace/lists/$id");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    readRouterMocks().useParams.mockReturnValue({ id: "list-1" });
    const Component = asRouteStub(routeModule.Route).options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/lists/list-1/export?format=csv", {
        headers: { Accept: "text/csv" },
      });
    });
    expect(createObjectUrl).not.toHaveBeenCalled();
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
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(jsonExport),
      });
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

    const routeModule = await import("@/routes/_workspace/lists/$id");
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
});
