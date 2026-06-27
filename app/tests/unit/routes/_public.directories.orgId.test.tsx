// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
      workspace: { id: "tenant-kc", name: "Tenant KC" },
      entries: [],
      trust_footer: {
        label: "Powered by Atlas",
        provenance_required: true,
        body: "Every listed profile keeps source packets and claim-level evidence.",
      },
    });

    const routeModule = await import("@/routes/_public/directories.$orgId");
    const { asRouteStub } = await import("@/../tests/helpers/router-harness");
    const Route = asRouteStub(routeModule.Route);

    if (!Route.options.loader) throw new Error("Expected loader");
    await Route.options.loader({ params: { orgId: "tenant-kc" } });
    expect(loadPublicDirectory).toHaveBeenCalledWith({ data: { orgId: "tenant-kc" } });
  });

  it("renders entries, claim evidence, and the powered-by trust footer", async () => {
    const { readRouterMocks, asRouteStub } = await import("@/../tests/helpers/router-harness");
    const router = readRouterMocks();
    router.useLoaderData.mockReturnValue({
      directory: {
        workspace: {
          id: "tenant-kc",
          name: "Tenant KC",
          custom_domain: { domain: "guide.kctenants.org", status: "verified" },
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

    const routeModule = await import("@/routes/_public/directories.$orgId");
    const Route = asRouteStub(routeModule.Route);
    const Component = Route.options.component;
    if (!Component) throw new Error("Expected component");
    render(<Component />);

    expect(screen.getByRole("heading", { level: 1, name: "Tenant KC" })).toBeInTheDocument();
    expect(screen.getByText("KC Tenants")).toBeInTheDocument();
    expect(screen.getByText("2 sources")).toBeInTheDocument();
    expect(screen.getByText("corroborated")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open profile" })).toHaveAttribute(
      "href",
      "/profiles/organizations/kc-tenants",
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
});
