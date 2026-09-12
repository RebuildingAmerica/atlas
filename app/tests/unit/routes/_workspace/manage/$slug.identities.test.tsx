// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const buttonMocks = vi.hoisted(() => ({
  clicks: new Map<string, (() => void) | undefined>(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/catalog/hooks/use-claims", () => ({
  useAttachProfileAtprotoIdentity: vi.fn(),
  useDetachProfileAtprotoIdentity: vi.fn(),
  useManageProfile: vi.fn(),
}));

vi.mock("@/domains/access/atproto-identities", () => ({
  useAtprotoIdentities: vi.fn(),
}));

vi.mock("@rebuildingamerica/atlas-ui/ui/confirm-dialog", () => ({
  useConfirmDialog: vi.fn(),
}));

vi.mock("@rebuildingamerica/atlas-catalog/hooks/use-entries", () => ({
  useEntryBySlug: vi.fn(),
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
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      ref={() => {
        if (typeof children === "string") buttonMocks.clicks.set(children, onClick);
      }}
    >
      {children}
    </button>
  ),
}));

describe("routes/_workspace/manage/$slug", () => {
  beforeEach(async () => {
    buttonMocks.clicks.clear();
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const identities = await import("@/domains/access/atproto-identities");
    const dialogs = await import("@rebuildingamerica/atlas-ui/ui/confirm-dialog");
    vi.mocked(claims.useManageProfile).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    } as unknown as ReturnType<typeof claims.useManageProfile>);
    vi.mocked(claims.useAttachProfileAtprotoIdentity).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    } as unknown as ReturnType<typeof claims.useAttachProfileAtprotoIdentity>);
    vi.mocked(claims.useDetachProfileAtprotoIdentity).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    } as unknown as ReturnType<typeof claims.useDetachProfileAtprotoIdentity>);
    vi.mocked(identities.useAtprotoIdentities).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof identities.useAtprotoIdentities>);
    vi.mocked(dialogs.useConfirmDialog).mockReturnValue({
      confirm: vi.fn().mockResolvedValue(true),
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  async function renderManageRoute(slug = "acme") {
    const routeModule = await import("@/routes/_workspace/manage/$slug");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ slug });

    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
  }

  it("attaches a verified controlled identity", async () => {
    const entriesHooks = await import("@rebuildingamerica/atlas-catalog/hooks/use-entries");
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const identities = await import("@/domains/access/atproto-identities");
    const attach = vi.fn().mockResolvedValue(undefined);
    vi.mocked(claims.useAttachProfileAtprotoIdentity).mockReturnValue({
      mutateAsync: attach,
      isPending: false,
    } as unknown as ReturnType<typeof claims.useAttachProfileAtprotoIdentity>);
    vi.mocked(identities.useAtprotoIdentities).mockReturnValue({
      data: [
        {
          id: "identity-1",
          did: "did:plc:jane",
          current_handle: "jane.example",
          resolution_status: "verified",
          control_status: "active",
        },
      ],
    } as unknown as ReturnType<typeof identities.useAtprotoIdentities>);
    vi.mocked(entriesHooks.useEntryBySlug).mockReturnValue({
      data: {
        id: "e1",
        slug: "jane",
        type: "person",
        name: "Jane",
        sources: [],
        claim: { status: "verified" },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof entriesHooks.useEntryBySlug>);

    await renderManageRoute("jane");
    fireEvent.change(screen.getByLabelText("ATProto identity"), {
      target: { value: "identity-1" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Attach identity" }));
      await Promise.resolve();
    });
    expect(attach).toHaveBeenCalledWith({
      slug: "jane",
      body: { atproto_identity_id: "identity-1", replace: false },
    });
  });

  it("confirms and removes a public identity without disconnecting it", async () => {
    const entriesHooks = await import("@rebuildingamerica/atlas-catalog/hooks/use-entries");
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const dialogs = await import("@rebuildingamerica/atlas-ui/ui/confirm-dialog");
    const detach = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.fn().mockResolvedValue(true);
    vi.mocked(dialogs.useConfirmDialog).mockReturnValue({
      confirm,
    });
    vi.mocked(claims.useDetachProfileAtprotoIdentity).mockReturnValue({
      mutateAsync: detach,
      isPending: false,
    } as unknown as ReturnType<typeof claims.useDetachProfileAtprotoIdentity>);
    vi.mocked(entriesHooks.useEntryBySlug).mockReturnValue({
      data: {
        id: "e1",
        slug: "jane",
        type: "person",
        name: "Jane",
        sources: [],
        claim: { status: "verified", linked_atproto_handle: "jane.example" },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof entriesHooks.useEntryBySlug>);

    await renderManageRoute("jane");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove identity" }));
      await Promise.resolve();
    });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Remove public identity?", destructive: true }),
    );
    expect(detach).toHaveBeenCalledWith("jane");
  });

  it("blocks overlapping public identity mutations", async () => {
    const entriesHooks = await import("@rebuildingamerica/atlas-catalog/hooks/use-entries");
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const identities = await import("@/domains/access/atproto-identities");
    vi.mocked(claims.useAttachProfileAtprotoIdentity).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: true,
    } as unknown as ReturnType<typeof claims.useAttachProfileAtprotoIdentity>);
    vi.mocked(identities.useAtprotoIdentities).mockReturnValue({
      data: [
        {
          id: "identity-new",
          did: "did:plc:new",
          current_handle: "new.example",
          resolution_status: "verified",
          control_status: "active",
        },
      ],
    } as unknown as ReturnType<typeof identities.useAtprotoIdentities>);
    vi.mocked(entriesHooks.useEntryBySlug).mockReturnValue({
      data: {
        id: "e1",
        slug: "jane",
        type: "person",
        name: "Jane",
        sources: [],
        claim: { status: "verified", linked_atproto_handle: "old.example" },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof entriesHooks.useEntryBySlug>);

    await renderManageRoute("jane");
    fireEvent.change(screen.getByLabelText("ATProto identity"), {
      target: { value: "identity-new" },
    });
    expect(screen.getByRole("button", { name: "Replace identity" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove identity" })).toBeDisabled();

    vi.mocked(claims.useAttachProfileAtprotoIdentity).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    } as unknown as ReturnType<typeof claims.useAttachProfileAtprotoIdentity>);
    vi.mocked(claims.useDetachProfileAtprotoIdentity).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: true,
    } as unknown as ReturnType<typeof claims.useDetachProfileAtprotoIdentity>);
    cleanup();
    await renderManageRoute("jane");
    fireEvent.change(screen.getByLabelText("ATProto identity"), {
      target: { value: "identity-new" },
    });

    expect(screen.getByRole("button", { name: "Replace identity" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove identity" })).toBeDisabled();
  });

  it("requires confirmation before replacing the public identity", async () => {
    const entriesHooks = await import("@rebuildingamerica/atlas-catalog/hooks/use-entries");
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const identities = await import("@/domains/access/atproto-identities");
    const dialogs = await import("@rebuildingamerica/atlas-ui/ui/confirm-dialog");
    const attach = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.fn().mockResolvedValue(true);
    vi.mocked(dialogs.useConfirmDialog).mockReturnValue({ confirm });
    vi.mocked(claims.useAttachProfileAtprotoIdentity).mockReturnValue({
      mutateAsync: attach,
      isPending: false,
    } as unknown as ReturnType<typeof claims.useAttachProfileAtprotoIdentity>);
    vi.mocked(identities.useAtprotoIdentities).mockReturnValue({
      data: [
        {
          id: "identity-new",
          did: "did:plc:new",
          current_handle: "new.example",
          resolution_status: "verified",
          control_status: "active",
        },
      ],
    } as unknown as ReturnType<typeof identities.useAtprotoIdentities>);
    vi.mocked(entriesHooks.useEntryBySlug).mockReturnValue({
      data: {
        id: "e1",
        slug: "jane",
        type: "person",
        name: "Jane",
        sources: [],
        claim: { status: "verified", linked_atproto_handle: "old.example" },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof entriesHooks.useEntryBySlug>);

    await renderManageRoute("jane");
    fireEvent.change(screen.getByLabelText("ATProto identity"), {
      target: { value: "identity-new" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Replace identity" }));
      await Promise.resolve();
    });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Replace public identity?" }),
    );
    expect(attach).toHaveBeenCalledWith({
      slug: "jane",
      body: { atproto_identity_id: "identity-new", replace: true },
    });
  });

  it("keeps the existing public identity when replacement is cancelled", async () => {
    const entriesHooks = await import("@rebuildingamerica/atlas-catalog/hooks/use-entries");
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const identities = await import("@/domains/access/atproto-identities");
    const dialogs = await import("@rebuildingamerica/atlas-ui/ui/confirm-dialog");
    const attach = vi.fn();
    vi.mocked(dialogs.useConfirmDialog).mockReturnValue({
      confirm: vi.fn().mockResolvedValue(false),
    });
    vi.mocked(claims.useAttachProfileAtprotoIdentity).mockReturnValue({
      mutateAsync: attach,
      isPending: false,
    } as unknown as ReturnType<typeof claims.useAttachProfileAtprotoIdentity>);
    vi.mocked(identities.useAtprotoIdentities).mockReturnValue({
      data: [
        {
          id: "identity-new",
          did: "did:plc:new",
          current_handle: "new.example",
          resolution_status: "verified",
          control_status: "active",
        },
      ],
    } as unknown as ReturnType<typeof identities.useAtprotoIdentities>);
    vi.mocked(entriesHooks.useEntryBySlug).mockReturnValue({
      data: {
        id: "e1",
        slug: "jane",
        type: "person",
        name: "Jane",
        sources: [],
        claim: { status: "verified", linked_atproto_handle: "old.example" },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof entriesHooks.useEntryBySlug>);

    await renderManageRoute("jane");
    fireEvent.change(screen.getByLabelText("ATProto identity"), {
      target: { value: "identity-new" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Replace identity" }));
      await Promise.resolve();
    });

    expect(attach).not.toHaveBeenCalled();
  });

  it("keeps the public identity when removal is cancelled", async () => {
    const entriesHooks = await import("@rebuildingamerica/atlas-catalog/hooks/use-entries");
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const dialogs = await import("@rebuildingamerica/atlas-ui/ui/confirm-dialog");
    const detach = vi.fn();
    vi.mocked(dialogs.useConfirmDialog).mockReturnValue({
      confirm: vi.fn().mockResolvedValue(false),
    });
    vi.mocked(claims.useDetachProfileAtprotoIdentity).mockReturnValue({
      mutateAsync: detach,
      isPending: false,
    } as unknown as ReturnType<typeof claims.useDetachProfileAtprotoIdentity>);
    vi.mocked(entriesHooks.useEntryBySlug).mockReturnValue({
      data: {
        id: "e1",
        slug: "jane",
        type: "person",
        name: "Jane",
        sources: [],
        claim: { status: "verified", linked_atproto_handle: "jane.example" },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof entriesHooks.useEntryBySlug>);

    await renderManageRoute("jane");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove identity" }));
      await Promise.resolve();
    });

    expect(detach).not.toHaveBeenCalled();
  });

  it("starts account OAuth with a return to the managed profile", async () => {
    const entriesHooks = await import("@rebuildingamerica/atlas-catalog/hooks/use-entries");
    vi.mocked(entriesHooks.useEntryBySlug).mockReturnValue({
      data: {
        id: "e1",
        slug: "jane",
        type: "person",
        name: "Jane",
        sources: [],
        claim: { status: "verified" },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof entriesHooks.useEntryBySlug>);

    await renderManageRoute("jane");
    fireEvent.change(screen.getByLabelText("Another ATProto handle"), {
      target: { value: "jane.example" },
    });
    expect(screen.getByRole("button", { name: "Connect another account" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Connect another account" }));
  });

  it("ignores identity actions when their required selection is empty", async () => {
    const entriesHooks = await import("@rebuildingamerica/atlas-catalog/hooks/use-entries");
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const attach = vi.fn();
    vi.mocked(claims.useAttachProfileAtprotoIdentity).mockReturnValue({
      mutateAsync: attach,
      isPending: false,
    } as unknown as ReturnType<typeof claims.useAttachProfileAtprotoIdentity>);
    vi.mocked(entriesHooks.useEntryBySlug).mockReturnValue({
      data: {
        id: "e1",
        slug: "jane",
        type: "person",
        name: "Jane",
        sources: [],
        claim: { status: "verified" },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof entriesHooks.useEntryBySlug>);

    await renderManageRoute("jane");
    buttonMocks.clicks.get("Attach identity")?.();
    buttonMocks.clicks.get("Connect another account")?.();

    expect(attach).not.toHaveBeenCalled();
  });

  it("excludes disconnected and attention-required identities", async () => {
    const entriesHooks = await import("@rebuildingamerica/atlas-catalog/hooks/use-entries");
    const identities = await import("@/domains/access/atproto-identities");
    vi.mocked(identities.useAtprotoIdentities).mockReturnValue({
      data: [
        {
          id: "identity-active",
          did: "did:plc:active",
          current_handle: "active.example",
          resolution_status: "verified",
          control_status: "active",
        },
        {
          id: "identity-disconnected",
          did: "did:plc:disconnected",
          current_handle: "disconnected.example",
          resolution_status: "verified",
          control_status: "disconnected",
        },
        {
          id: "identity-stale",
          did: "did:plc:stale",
          current_handle: "stale.example",
          resolution_status: "needs_attention",
          control_status: "active",
        },
      ],
    } as unknown as ReturnType<typeof identities.useAtprotoIdentities>);
    vi.mocked(entriesHooks.useEntryBySlug).mockReturnValue({
      data: {
        id: "e1",
        slug: "jane",
        type: "person",
        name: "Jane",
        sources: [],
        claim: { status: "verified" },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof entriesHooks.useEntryBySlug>);

    await renderManageRoute("jane");
    expect(screen.getByRole("option", { name: "active.example" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "disconnected.example" })).toBeNull();
    expect(screen.queryByRole("option", { name: "stale.example" })).toBeNull();
  });

  it("renders on the server, where there is no browser URL to preselect an identity from", async () => {
    const entriesHooks = await import("@rebuildingamerica/atlas-catalog/hooks/use-entries");
    const { renderToStaticMarkup } = await import("react-dom/server");
    vi.mocked(entriesHooks.useEntryBySlug).mockReturnValue({
      data: {
        id: "e1",
        slug: "acme",
        type: "organization",
        name: "Acme",
        sources: [],
        claim: { status: "verified" },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof entriesHooks.useEntryBySlug>);
    const routeModule = await import("@/routes/_workspace/manage/$slug");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    readRouterMocks().useParams.mockReturnValue({ slug: "acme" });
    const Component = asRouteStub(routeModule.Route).options.component;
    if (!Component) throw new Error("Expected Route.options.component");

    vi.stubGlobal("window", undefined);
    const html = renderToStaticMarkup(<Component />);
    vi.unstubAllGlobals();

    expect(html).toContain("Manage Acme");
    expect(html).toContain("Public identity");
    expect(html).not.toContain("atprotoIdentityId");
  });
});
