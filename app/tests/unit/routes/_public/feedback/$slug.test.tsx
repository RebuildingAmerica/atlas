// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/catalog/server/profiles/profile-loaders", () => ({
  loadEntryBySlugAny: vi.fn(),
}));

vi.mock("@rebuildingamerica/atlas-api-client/generated/atlas", () => ({
  createEntityFlag: vi.fn(),
}));

vi.mock("@rebuildingamerica/atlas-ui/layout/page-layout", () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@rebuildingamerica/atlas-ui/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@rebuildingamerica/atlas-ui/ui/button", () => ({
  Button: ({
    children,
    disabled,
    type,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    type?: "button" | "submit" | "reset";
  }) => (
    <button type={type ?? "button"} disabled={disabled}>
      {children}
    </button>
  ),
}));

describe("routes/_public/feedback/$slug", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    const { createEntityFlag } =
      await import("@rebuildingamerica/atlas-api-client/generated/atlas");
    vi.mocked(createEntityFlag).mockReset();
    vi.mocked(createEntityFlag).mockResolvedValue({
      id: "flag-1",
      target_type: "entity",
      target_id: "entry-1",
      reason: "incorrect",
      status: "open",
      created_at: "2026-06-25T00:00:00Z",
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("validates feedback kind search params and loads the entry by slug", async () => {
    const { loadEntryBySlugAny } =
      await import("@/domains/catalog/server/profiles/profile-loaders");
    const entry = { id: "entry-1", name: "Acme", slug: "acme", type: "organization" };
    vi.mocked(loadEntryBySlugAny).mockResolvedValue(
      entry as Awaited<ReturnType<typeof loadEntryBySlugAny>>,
    );

    const routeModule = await import("@/routes/_public/feedback/$slug");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    const validator = Route.options.validateSearch as { parse: (input: unknown) => unknown };
    expect(validator.parse({ kind: "missing_context" })).toEqual({ kind: "missing_context" });

    if (!Route.options.loader) throw new Error("Expected loader");
    const data = await Route.options.loader({ params: { slug: "acme" } });
    expect(data).toEqual({ entry });

    if (!Route.options.head) throw new Error("Expected head");
    const head = Route.options.head({ loaderData: data }) as {
      meta: Record<string, string>[];
      links: Record<string, string>[];
    };
    expect(head.meta).toEqual(
      expect.arrayContaining([
        { title: "Improve Acme | Atlas" },
        { property: "og:url", content: "https://atlas.rebuildingamerica.com/feedback/acme" },
        { name: "robots", content: "noindex,nofollow" },
      ]),
    );
    expect(head.links).toContainEqual({
      rel: "canonical",
      href: "https://atlas.rebuildingamerica.com/feedback/acme",
    });
  });

  it("submits stale or incorrect feedback to the entity flag review loop", async () => {
    const { createEntityFlag } =
      await import("@rebuildingamerica/atlas-api-client/generated/atlas");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useParams.mockReturnValue({ slug: "acme" });
    router.useSearch.mockReturnValue({ kind: "incorrect" });
    router.useLoaderData.mockReturnValue({
      entry: { id: "entry-1", name: "Acme", slug: "acme", type: "organization" },
    });

    const routeModule = await import("@/routes/_public/feedback/$slug");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected Route.options.component");

    const view = render(<Component />);

    expect(screen.getByRole("dialog", { name: "Record review" })).toBeInTheDocument();
    expect(view.container.querySelector("main")).toBeNull();
    expect(screen.getByText("Review Acme")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Record stewardship" })).not.toBeInTheDocument();
    expect(screen.queryByText("Public source")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Stale or incorrect information")).toBeChecked();

    fireEvent.change(screen.getByLabelText("What should be reviewed?"), {
      target: { value: "The listed phone number is no longer active." },
    });
    fireEvent.change(screen.getByLabelText("Contact email, optional"), {
      target: { value: "tips@example.org" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
      await Promise.resolve();
    });

    expect(createEntityFlag).toHaveBeenCalledWith({
      entity_id: "entry-1",
      reason: "incorrect",
      note: "The listed phone number is no longer active.\n\nContact: tips@example.org",
    });
    expect(screen.getByRole("status")).toHaveTextContent("Received for review.");
  });

  it("publishes no metadata when the entry could not be loaded", async () => {
    const routeModule = await import("@/routes/_public/feedback/$slug");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.head) throw new Error("Expected head");
    expect(Route.options.head({ loaderData: undefined })).toEqual({});
  });

  it("sends a person's review under the chosen reason, with no contact line", async () => {
    const { createEntityFlag } =
      await import("@rebuildingamerica/atlas-api-client/generated/atlas");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useSearch.mockReturnValue({ kind: "incorrect" });
    router.useLoaderData.mockReturnValue({
      entry: { id: "entry-2", name: "Ada Reyes", slug: "ada-reyes", type: "person" },
    });

    const routeModule = await import("@/routes/_public/feedback/$slug");
    const Component = asRouteStub(routeModule.Route).options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const view = render(<Component />);

    // The harness Link renders the resolved href, which is what a visitor
    // would follow out of the review dialog.
    expect(view.container.querySelector("a[data-link-to]")).toHaveAttribute(
      "href",
      "/profiles/people/ada-reyes",
    );

    fireEvent.click(screen.getByLabelText("Representation concern"));
    fireEvent.change(screen.getByLabelText("What should be reviewed?"), {
      target: { value: "The role listed here is out of date." },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
      await Promise.resolve();
    });

    expect(createEntityFlag).toHaveBeenCalledWith({
      entity_id: "entry-2",
      reason: "representation",
      note: "The role listed here is out of date.",
    });
    expect(screen.getByRole("status")).toHaveTextContent("Received for review.");
  });

  it("does not send an empty review", async () => {
    const { createEntityFlag } =
      await import("@rebuildingamerica/atlas-api-client/generated/atlas");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useSearch.mockReturnValue({ kind: "missing_context" });
    router.useLoaderData.mockReturnValue({
      entry: { id: "entry-1", name: "Acme", slug: "acme", type: "organization" },
    });

    const routeModule = await import("@/routes/_public/feedback/$slug");
    const Component = asRouteStub(routeModule.Route).options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    const view = render(<Component />);

    expect(screen.getByLabelText("Missing context")).toBeChecked();
    fireEvent.change(screen.getByLabelText("What should be reviewed?"), {
      target: { value: "   " },
    });

    const form = view.container.querySelector("form");
    if (!form) throw new Error("Expected the review form");
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(createEntityFlag).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("tells the visitor when the review could not be filed", async () => {
    const { createEntityFlag } =
      await import("@rebuildingamerica/atlas-api-client/generated/atlas");
    vi.mocked(createEntityFlag).mockImplementation(() => {
      throw new Error("Review queue is unavailable.");
    });
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useSearch.mockReturnValue({ kind: "incorrect" });
    router.useLoaderData.mockReturnValue({
      entry: { id: "entry-1", name: "Acme", slug: "acme", type: "organization" },
    });

    const routeModule = await import("@/routes/_public/feedback/$slug");
    const Component = asRouteStub(routeModule.Route).options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    fireEvent.change(screen.getByLabelText("What should be reviewed?"), {
      target: { value: "The address is wrong." },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
      await Promise.resolve();
    });

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit for review" })).toBeEnabled();
  });

  it("falls back to plain wording when the failure carries no message", async () => {
    const { createEntityFlag } =
      await import("@rebuildingamerica/atlas-api-client/generated/atlas");
    vi.mocked(createEntityFlag).mockImplementation(() => {
      // A rejected value that is not an Error is exactly what this covers.
      const failure: unknown = "dropped";
      throw failure;
    });
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useSearch.mockReturnValue({ kind: "incorrect" });
    router.useLoaderData.mockReturnValue({
      entry: { id: "entry-1", name: "Acme", slug: "acme", type: "organization" },
    });

    const routeModule = await import("@/routes/_public/feedback/$slug");
    const Component = asRouteStub(routeModule.Route).options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    fireEvent.change(screen.getByLabelText("What should be reviewed?"), {
      target: { value: "The address is wrong." },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
      await Promise.resolve();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Could not submit feedback.");
  });

  it("shows the submission in flight and clears the form once it lands", async () => {
    const { createEntityFlag } =
      await import("@rebuildingamerica/atlas-api-client/generated/atlas");
    let settle: (() => void) | undefined;
    vi.mocked(createEntityFlag).mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = () => {
            resolve({
              id: "flag-2",
              target_type: "entity",
              target_id: "entry-1",
              reason: "incorrect",
              status: "open",
              created_at: "2026-06-25T00:00:00Z",
            });
          };
        }),
    );
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useSearch.mockReturnValue({ kind: "incorrect" });
    router.useLoaderData.mockReturnValue({
      entry: { id: "entry-1", name: "Acme", slug: "acme", type: "organization" },
    });

    const routeModule = await import("@/routes/_public/feedback/$slug");
    const Component = asRouteStub(routeModule.Route).options.component;
    if (!Component) throw new Error("Expected Route.options.component");
    render(<Component />);

    const note = screen.getByLabelText("What should be reviewed?");
    fireEvent.change(note, { target: { value: "The address is wrong." } });
    fireEvent.change(screen.getByLabelText("Contact email, optional"), {
      target: { value: "tips@example.org" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "Submitting..." })).toBeDisabled();

    await act(async () => {
      settle?.();
      await Promise.resolve();
    });

    expect(screen.getByRole("status")).toHaveTextContent("Received for review.");
    expect(note).toHaveValue("");
    expect(screen.getByLabelText("Contact email, optional")).toHaveValue("");
  });

  it("refuses to render a review form for an unknown feedback kind", async () => {
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useSearch.mockReturnValue({ kind: "sabotage" });
    router.useLoaderData.mockReturnValue({
      entry: { id: "entry-1", name: "Acme", slug: "acme", type: "organization" },
    });

    const routeModule = await import("@/routes/_public/feedback/$slug");
    const Component = asRouteStub(routeModule.Route).options.component;
    if (!Component) throw new Error("Expected Route.options.component");

    expect(() => render(<Component />)).toThrow("Unsupported feedback kind: sabotage");
  });
});
