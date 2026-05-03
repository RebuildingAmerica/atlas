// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readManageProfileCall } from "@/../tests/fixtures/routes/manage-profile-call";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/catalog/hooks/use-claims", () => ({
  useManageProfile: vi.fn(),
}));

vi.mock("@/domains/catalog/hooks/use-entries", () => ({
  useEntryBySlug: vi.fn(),
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

describe("routes/_workspace/manage/$slug", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useManageProfile).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: false,
    } as unknown as ReturnType<typeof claims.useManageProfile>);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("shows the loading copy while neither person nor org query has data", async () => {
    const entriesHooks = await import("@/domains/catalog/hooks/use-entries");
    vi.mocked(entriesHooks.useEntryBySlug).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as unknown as ReturnType<typeof entriesHooks.useEntryBySlug>);

    const routeModule = await import("@/routes/_workspace/manage.$slug");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ slug: "acme" });

    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByText(/Loading profile…/)).toBeInTheDocument();
  });

  it("shows the not-yours-to-manage copy when claim status is not verified", async () => {
    const entriesHooks = await import("@/domains/catalog/hooks/use-entries");
    vi.mocked(entriesHooks.useEntryBySlug).mockReturnValue({
      data: {
        id: "e1",
        slug: "acme",
        type: "organization",
        name: "Acme",
        custom_bio: null,
        photo_url: null,
        preferred_contact_channel: null,
        sources: [],
        claim: { status: "pending" },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof entriesHooks.useEntryBySlug>);

    const routeModule = await import("@/routes/_workspace/manage.$slug");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ slug: "acme" });

    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByText("This profile is not yours to manage")).toBeInTheDocument();
  });

  it("renders the verified-management form with sources and saves trimmed input", async () => {
    const entriesHooks = await import("@/domains/catalog/hooks/use-entries");
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const saveMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(claims.useManageProfile).mockReturnValue({
      mutateAsync: saveMock,
      isPending: false,
    } as unknown as ReturnType<typeof claims.useManageProfile>);
    vi.mocked(entriesHooks.useEntryBySlug).mockReturnValue({
      data: {
        id: "e1",
        slug: "acme",
        type: "organization",
        name: "Acme",
        custom_bio: "  start ",
        photo_url: " https://img.test/a.png ",
        preferred_contact_channel: "email",
        sources: [
          {
            id: "s1",
            url: "https://acme.test/news",
            title: "Story",
            publication: "Acme Times",
            published_date: "2024-01-01",
          },
          {
            id: "s2",
            url: "https://acme.test/post",
            title: null,
            publication: null,
            published_date: null,
          },
        ],
        claim: { status: "verified" },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof entriesHooks.useEntryBySlug>);

    const routeModule = await import("@/routes/_workspace/manage.$slug");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ slug: "acme" });

    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByText("Manage Acme")).toBeInTheDocument();
    expect(screen.getByText("Story")).toBeInTheDocument();
    expect(screen.getByText(/Unknown publication/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Suppress Story"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));
      await Promise.resolve();
    });
    const call = readManageProfileCall(saveMock);
    expect(call.slug).toBe("acme");
    expect(call.body.custom_bio).toBe("start");
    expect(call.body.photo_url).toBe("https://img.test/a.png");
    expect(call.body.preferred_contact_channel).toBe("email");
    expect(call.body.suppressed_source_ids).toEqual(["s1"]);
    expect(call.body.clear_photo).toBe(false);
    expect(call.body.clear_custom_bio).toBe(false);
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");

    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("toggles a source off when re-clicked and clears bio/photo when emptied", async () => {
    const entriesHooks = await import("@/domains/catalog/hooks/use-entries");
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const saveMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(claims.useManageProfile).mockReturnValue({
      mutateAsync: saveMock,
      isPending: false,
    } as unknown as ReturnType<typeof claims.useManageProfile>);
    vi.mocked(entriesHooks.useEntryBySlug).mockReturnValue({
      data: {
        id: "e1",
        slug: "jane",
        type: "person",
        name: "Jane",
        custom_bio: null,
        photo_url: null,
        preferred_contact_channel: null,
        sources: [
          {
            id: "s1",
            url: "https://jane.test/news",
            title: "Story",
            publication: "JT",
            published_date: "2024-01-01",
          },
        ],
        claim: { status: "verified" },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof entriesHooks.useEntryBySlug>);

    const routeModule = await import("@/routes/_workspace/manage.$slug");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ slug: "jane" });

    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    fireEvent.click(screen.getByLabelText("Suppress Story"));
    fireEvent.click(screen.getByLabelText("Suppress Story"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));
      await Promise.resolve();
    });
    const call = readManageProfileCall(saveMock);
    expect(call.body.custom_bio).toBeUndefined();
    expect(call.body.photo_url).toBeUndefined();
    expect(call.body.preferred_contact_channel).toBeUndefined();
    expect(call.body.suppressed_source_ids).toEqual([]);
    expect(call.body.clear_photo).toBe(true);
    expect(call.body.clear_custom_bio).toBe(true);
  });

  it("updates the bio, photo URL, and preferred contact channel through controlled inputs", async () => {
    const entriesHooks = await import("@/domains/catalog/hooks/use-entries");
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const saveMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(claims.useManageProfile).mockReturnValue({
      mutateAsync: saveMock,
      isPending: false,
    } as unknown as ReturnType<typeof claims.useManageProfile>);
    vi.mocked(entriesHooks.useEntryBySlug).mockReturnValue({
      data: {
        id: "e1",
        slug: "acme",
        type: "organization",
        name: "Acme",
        custom_bio: null,
        photo_url: null,
        preferred_contact_channel: null,
        sources: [],
        claim: { status: "verified" },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof entriesHooks.useEntryBySlug>);

    const routeModule = await import("@/routes/_workspace/manage.$slug");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ slug: "acme" });

    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    fireEvent.change(screen.getByPlaceholderText(/Write a short bio/), {
      target: { value: "New bio" },
    });
    fireEvent.change(screen.getByPlaceholderText("https://your-domain.example/your-photo.jpg"), {
      target: { value: "https://img.test/photo.jpg" },
    });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "form" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));
      await Promise.resolve();
    });
    const call = readManageProfileCall(saveMock);
    expect(call.body.custom_bio).toBe("New bio");
    expect(call.body.photo_url).toBe("https://img.test/photo.jpg");
    expect(call.body.preferred_contact_channel).toBe("form");
  });

  it("uses the generic save-error fallback when the rejection is not an Error", async () => {
    const entriesHooks = await import("@/domains/catalog/hooks/use-entries");
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useManageProfile).mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue("string-fail"),
      isPending: false,
    } as unknown as ReturnType<typeof claims.useManageProfile>);
    vi.mocked(entriesHooks.useEntryBySlug).mockReturnValue({
      data: {
        id: "e1",
        slug: "acme",
        type: "organization",
        name: "Acme",
        custom_bio: null,
        photo_url: null,
        preferred_contact_channel: null,
        sources: undefined,
        claim: { status: "verified" },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof entriesHooks.useEntryBySlug>);

    const routeModule = await import("@/routes/_workspace/manage.$slug");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ slug: "acme" });

    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save changes.");
  });

  it("renders the saving label while the manage mutation is pending", async () => {
    const entriesHooks = await import("@/domains/catalog/hooks/use-entries");
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useManageProfile).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue(undefined),
      isPending: true,
    } as unknown as ReturnType<typeof claims.useManageProfile>);
    vi.mocked(entriesHooks.useEntryBySlug).mockReturnValue({
      data: {
        id: "e1",
        slug: "acme",
        type: "organization",
        name: "Acme",
        custom_bio: null,
        photo_url: null,
        preferred_contact_channel: null,
        sources: [],
        claim: { status: "verified" },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof entriesHooks.useEntryBySlug>);

    const routeModule = await import("@/routes/_workspace/manage.$slug");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ slug: "acme" });

    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByRole("button", { name: /Saving…/ })).toBeDisabled();
  });

  it("surfaces an error message when the save mutation rejects", async () => {
    const entriesHooks = await import("@/domains/catalog/hooks/use-entries");
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useManageProfile).mockReturnValue({
      mutateAsync: vi.fn().mockRejectedValue(new Error("nope")),
      isPending: false,
    } as unknown as ReturnType<typeof claims.useManageProfile>);
    vi.mocked(entriesHooks.useEntryBySlug).mockReturnValue({
      data: {
        id: "e1",
        slug: "acme",
        type: "organization",
        name: "Acme",
        custom_bio: null,
        photo_url: null,
        preferred_contact_channel: null,
        sources: [],
        claim: { status: "verified" },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof entriesHooks.useEntryBySlug>);

    const routeModule = await import("@/routes/_workspace/manage.$slug");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ slug: "acme" });

    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);
    expect(screen.getByText(/No sources surfaced yet/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("nope");
  });
});
