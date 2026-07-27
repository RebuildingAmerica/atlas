// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/catalog/server/public-directory", () => ({
  loadPublicDirectory: vi.fn(),
}));

describe("routes/_public/directories/$orgId", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads a workspace public directory by org id", async () => {
    const { loadPublicDirectory } = await import("@/domains/catalog/server/public-directory");
    vi.mocked(loadPublicDirectory).mockResolvedValue({
      title: "Tenant KC civic directory",
      sponsor_label: null,
      workspace: { id: "tenant-kc", name: "Tenant KC" },
      scope: {
        issue_area_ids: [],
        geography_labels: [],
        entry_types: [],
      },
      stats: {
        record_count: 0,
        source_count: 0,
        source_backed_record_count: 0,
        last_reviewed_at: null,
      },
      publication: {
        visibility: "public",
        private_notes_exposed: false,
      },
      methodology: {
        summary: "Records qualify after workspace review and linked source evidence.",
        source_policy: "Every public record includes at least one linked source packet.",
        review_policy: "Unsourced workspace records are held for review before publication.",
        correction_policy:
          "Each listed record accepts stale, incorrect, or missing-context feedback.",
        correction_path_template: "/feedback/{slug}?kind=incorrect",
        missing_context_path_template: "/feedback/{slug}?kind=missing_context",
      },
      entries: [],
      trust_footer: {
        label: "Powered by Atlas",
        provenance_required: true,
        body: "Every listed profile keeps source packets and claim-level evidence.",
      },
    });

    const routeModule = await import("@/routes/_public/directories/$orgId");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    const loaded = await Route.options.loader({ params: { orgId: "tenant-kc" } });
    expect(loadPublicDirectory).toHaveBeenCalledWith({ data: { orgId: "tenant-kc" } });

    if (!Route.options.head) throw new Error("Expected head");
    const head = Route.options.head({
      loaderData: loaded,
      params: { orgId: "tenant-kc" },
    }) as {
      meta: Record<string, string>[];
      links: Record<string, string>[];
    };
    expect(head.meta).toEqual(
      expect.arrayContaining([
        { title: "Tenant KC civic directory | Atlas" },
        {
          property: "og:url",
          content: "https://atlas.rebuildingamerica.com/directories/tenant-kc",
        },
        { name: "twitter:card", content: "summary_large_image" },
      ]),
    );
    expect(head.links).toContainEqual({
      rel: "canonical",
      href: "https://atlas.rebuildingamerica.com/directories/tenant-kc",
    });
  });

  it("renders entries, claim evidence, and the powered-by trust footer", async () => {
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useLoaderData.mockReturnValue({
      directory: {
        title: "Kansas City tenant power directory",
        sponsor_label: "Supported by Tenant KC",
        workspace: {
          id: "tenant-kc",
          name: "Tenant KC",
          custom_domain: { domain: "guide.kctenants.org", status: "verified" },
        },
        scope: {
          issue_area_ids: ["housing_affordability"],
          geography_labels: ["Kansas City, MO"],
          entry_types: ["organization"],
        },
        stats: {
          record_count: 1,
          source_count: 2,
          source_backed_record_count: 1,
          last_reviewed_at: "2026-07-03",
        },
        publication: {
          visibility: "public",
          private_notes_exposed: false,
        },
        methodology: {
          summary: "Records qualify after workspace review and linked source evidence.",
          source_policy: "Every public record includes at least one linked source packet.",
          review_policy: "Unsourced workspace records are held for review before publication.",
          correction_policy:
            "Each listed record accepts stale, incorrect, or missing-context feedback.",
          correction_path_template: "/feedback/{slug}?kind=incorrect",
          missing_context_path_template: "/feedback/{slug}?kind=missing_context",
        },
        entries: [
          {
            id: "entry-1",
            name: "KC Tenants",
            type: "organization",
            description: "Tenant organizing group.",
            slug: "kc-tenants",
            source_count: 2,
            claim_evidence: {
              summary: {
                confidence: "corroborated",
              },
            },
          },
        ],
        trust_footer: {
          label: "Powered by Atlas",
          provenance_required: true,
          body: "Every listed profile keeps source packets and claim-level evidence.",
        },
        federation: {
          label: "Shared with the Atlas commons",
          shared_record_count: 1,
          source_backed_record_count: 1,
          review_required: true,
          status: "open_with_review_gate",
          minimum_confidence: "source-backed public record",
          provenance_stamped_ingestion: true,
          body: "Public records from this directory can be reused by other Atlas-powered directories only with source evidence and workspace review.",
        },
      },
    });

    const routeModule = await import("@/routes/_public/directories/$orgId");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected component");
    render(<Component />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Kansas City tenant power directory" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Supported by Tenant KC")).toBeInTheDocument();
    expect(screen.getByText("Kansas City, MO")).toBeInTheDocument();
    expect(screen.getByText("Housing Affordability")).toBeInTheDocument();
    expect(screen.getByText("1 public profile")).toBeInTheDocument();
    expect(screen.getAllByText("2 sources")).toHaveLength(2);
    expect(screen.getByText("Last reviewed Jul 3, 2026")).toBeInTheDocument();
    expect(screen.getByText("Private workspace notes are not public.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Methodology" })).toBeInTheDocument();
    expect(
      screen.getByText("Records qualify after workspace review and linked source evidence."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Every public record includes at least one linked source packet."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Unsourced workspace records are held for review before publication."),
    ).toBeInTheDocument();
    expect(screen.getByText("KC Tenants")).toBeInTheDocument();
    expect(screen.getByText("corroborated")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open profile" })).toHaveAttribute(
      "href",
      "/profiles/organizations/kc-tenants",
    );
    expect(
      screen.getByRole("link", { name: "Report stale or incorrect information" }),
    ).toHaveAttribute("href", "/feedback/kc-tenants?kind=incorrect");
    expect(screen.getByRole("link", { name: "Suggest missing context" })).toHaveAttribute(
      "href",
      "/feedback/kc-tenants?kind=missing_context",
    );
    expect(screen.getByText("Powered by Atlas")).toBeInTheDocument();
    expect(screen.getByText("Verified domain: guide.kctenants.org")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Commons exchange" })).toBeInTheDocument();
    expect(screen.getByText("Shared with the Atlas commons")).toBeInTheDocument();
    expect(screen.getByText("1 shared record")).toBeInTheDocument();
    expect(screen.getByText("1 source-backed record")).toBeInTheDocument();
    expect(screen.getByText("Review required")).toBeInTheDocument();
    expect(screen.getByText("Open with review gate")).toBeInTheDocument();
    expect(screen.getByText("Source-backed public record")).toBeInTheDocument();
    expect(screen.getByText("Provenance-stamped ingestion")).toBeInTheDocument();
    expect(
      screen.getByText("Every listed profile keeps source packets and claim-level evidence."),
    ).toBeInTheDocument();
  });

  it("filters visible directory entries by public text", async () => {
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useLoaderData.mockReturnValue({
      directory: {
        title: "Kansas City tenant power directory",
        sponsor_label: null,
        workspace: {
          id: "tenant-kc",
          name: "Tenant KC",
        },
        scope: {
          issue_area_ids: ["housing_affordability"],
          geography_labels: ["Kansas City, MO"],
          entry_types: ["organization"],
        },
        stats: {
          record_count: 2,
          source_count: 3,
          source_backed_record_count: 2,
          last_reviewed_at: "2026-07-03",
        },
        publication: {
          visibility: "public",
          private_notes_exposed: false,
        },
        methodology: {
          summary: "Records qualify after workspace review and linked source evidence.",
          source_policy: "Every public record includes at least one linked source packet.",
          review_policy: "Unsourced workspace records are held for review before publication.",
          correction_policy:
            "Each listed record accepts stale, incorrect, or missing-context feedback.",
          correction_path_template: "/feedback/{slug}?kind=incorrect",
          missing_context_path_template: "/feedback/{slug}?kind=missing_context",
        },
        entries: [
          {
            id: "entry-1",
            name: "KC Tenants",
            type: "organization",
            description: "Tenant organizing group.",
            slug: "kc-tenants",
            city: "Kansas City",
            state: "MO",
            issue_areas: ["housing_affordability"],
            source_count: 2,
            claim_evidence: {
              summary: {
                confidence: "corroborated",
              },
            },
          },
          {
            id: "entry-2",
            name: "Heartland Legal Aid",
            type: "organization",
            description: "Eviction defense and housing legal support.",
            slug: "heartland-legal-aid",
            city: "Kansas City",
            state: "MO",
            issue_areas: ["housing_affordability"],
            source_count: 1,
            claim_evidence: {
              summary: {
                confidence: "unverified",
              },
            },
          },
          {
            id: "entry-3",
            name: "Westport Renters Circle",
            type: "organization",
            description: "Neighborhood renters meetup.",
            slug: "westport-renters-circle",
            city: "Kansas City",
            state: "MO",
            source_count: 1,
          },
        ],
        trust_footer: {
          label: "Powered by Atlas",
          provenance_required: true,
          body: "Every listed profile keeps source packets and claim-level evidence.",
        },
      },
    });

    const routeModule = await import("@/routes/_public/directories/$orgId");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected component");
    render(<Component />);

    expect(screen.getByText("KC Tenants")).toBeInTheDocument();
    expect(screen.getByText("Heartland Legal Aid")).toBeInTheDocument();
    expect(screen.getByText("Westport Renters Circle")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search directory"), {
      target: { value: "legal" },
    });

    expect(screen.queryByText("KC Tenants")).not.toBeInTheDocument();
    expect(screen.getByText("Heartland Legal Aid")).toBeInTheDocument();
    expect(screen.getByText("1 matching profile")).toBeInTheDocument();

    // A published record can arrive without issue tags or source types; the
    // reader should still be able to find it by name instead of hitting a crash.
    fireEvent.change(screen.getByLabelText("Search directory"), {
      target: { value: "westport" },
    });

    expect(screen.getByText("Westport Renters Circle")).toBeInTheDocument();
    expect(screen.queryByText("Heartland Legal Aid")).not.toBeInTheDocument();
  });

  it("publishes no metadata when the directory could not be loaded", async () => {
    const routeModule = await import("@/routes/_public/directories/$orgId");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.head) throw new Error("Expected head");
    expect(Route.options.head({ loaderData: undefined, params: { orgId: "tenant-kc" } })).toEqual(
      {},
    );
  });

  it("says a directory with no listings is empty rather than showing nothing", async () => {
    const support =
      await import("@/../tests/unit/routes/_public/directories/public-directory-test-support");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    readRouterMocks().useLoaderData.mockReturnValue({
      directory: support.publicDirectoryFixture({
        lastReviewedAt: null,
        privateNotesExposed: true,
      }),
    });

    const routeModule = await import("@/routes/_public/directories/$orgId");
    const Component = asRouteStub(routeModule.Route).options.component;
    if (!Component) throw new Error("Expected component");
    render(<Component />);

    expect(screen.getByText("No public profiles listed yet.")).toBeInTheDocument();
    expect(screen.getByText("No review date")).toBeInTheDocument();
    expect(screen.getByText("0 public profiles")).toBeInTheDocument();
    expect(screen.queryByText("Private workspace notes are not public.")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Search directory")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Commons exchange" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Verified domain/)).not.toBeInTheDocument();
  });

  it("says so when a search matches none of the listed profiles", async () => {
    const support =
      await import("@/../tests/unit/routes/_public/directories/public-directory-test-support");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    readRouterMocks().useLoaderData.mockReturnValue({
      directory: support.publicDirectoryFixture({
        entries: [
          support.directoryEntryFixture({
            id: "entry-1",
            name: "KC Tenants",
            slug: "kc-tenants",
            type: "organization",
          }),
        ],
      }),
    });

    const routeModule = await import("@/routes/_public/directories/$orgId");
    const Component = asRouteStub(routeModule.Route).options.component;
    if (!Component) throw new Error("Expected component");
    render(<Component />);

    fireEvent.change(screen.getByLabelText("Search directory"), {
      target: { value: "hospitals" },
    });

    expect(screen.getByText("No matching public profiles.")).toBeInTheDocument();
    expect(screen.getByText("0 matching profiles")).toBeInTheDocument();
  });

  it("links each listed type to its own profile section and admits unverified claims", async () => {
    const support =
      await import("@/../tests/unit/routes/_public/directories/public-directory-test-support");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    readRouterMocks().useLoaderData.mockReturnValue({
      directory: support.publicDirectoryFixture({
        entries: [
          support.directoryEntryFixture({
            id: "entry-1",
            name: "Ada Reyes",
            slug: "ada-reyes",
            sourceCount: 1,
            type: "person",
          }),
          support.directoryEntryFixture({
            id: "entry-2",
            name: "Rent Cap Now",
            slug: "rent-cap-now",
            type: "initiative",
          }),
        ],
      }),
    });

    const routeModule = await import("@/routes/_public/directories/$orgId");
    const Component = asRouteStub(routeModule.Route).options.component;
    if (!Component) throw new Error("Expected component");
    render(<Component />);

    const profileLinks = screen.getAllByRole("link", { name: "Open profile" });
    expect(profileLinks[0]).toHaveAttribute("href", "/profiles/people/ada-reyes");
    expect(profileLinks[1]).toHaveAttribute("href", "/profiles/initiatives/rent-cap-now");
    expect(screen.getByText("1 source")).toBeInTheDocument();
    // No claim evidence was recorded, so the badge must not imply any.
    expect(screen.getAllByText("unverified")).toHaveLength(2);
  });

  it("states an open federation policy in the reader's words", async () => {
    const support =
      await import("@/../tests/unit/routes/_public/directories/public-directory-test-support");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    readRouterMocks().useLoaderData.mockReturnValue({
      directory: support.publicDirectoryFixture({
        federation: {
          label: "Shared with the Atlas commons",
          shared_record_count: 1,
          source_backed_record_count: 4,
          review_required: false,
          status: "open",
          minimum_confidence: "",
          provenance_stamped_ingestion: false,
          body: "Public records from this directory can be reused by other Atlas directories.",
        },
      }),
    });

    const routeModule = await import("@/routes/_public/directories/$orgId");
    const Component = asRouteStub(routeModule.Route).options.component;
    if (!Component) throw new Error("Expected component");
    render(<Component />);

    expect(screen.getByText("Open reuse")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("Unstamped ingestion")).toBeInTheDocument();
    expect(screen.getByText("1 shared record")).toBeInTheDocument();
    expect(screen.getByText("4 source-backed records")).toBeInTheDocument();
  });

  it("shows a review date it cannot parse exactly as the workspace recorded it", async () => {
    const support =
      await import("@/../tests/unit/routes/_public/directories/public-directory-test-support");
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    readRouterMocks().useLoaderData.mockReturnValue({
      directory: support.publicDirectoryFixture({ lastReviewedAt: "last spring" }),
    });

    const routeModule = await import("@/routes/_public/directories/$orgId");
    const Component = asRouteStub(routeModule.Route).options.component;
    if (!Component) throw new Error("Expected component");
    const view = render(<Component />);

    expect(screen.getByText("Last reviewed last spring")).toBeInTheDocument();

    view.unmount();
    readRouterMocks().useLoaderData.mockReturnValue({
      directory: support.publicDirectoryFixture({ lastReviewedAt: "20xx-ab-cd" }),
    });
    render(<Component />);

    expect(screen.getByText("Last reviewed 20xx-ab-cd")).toBeInTheDocument();
  });
});
