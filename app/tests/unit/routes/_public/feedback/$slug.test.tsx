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

vi.mock("@/platform/layout/page-layout", () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/platform/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/platform/ui/button", () => ({
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
});
