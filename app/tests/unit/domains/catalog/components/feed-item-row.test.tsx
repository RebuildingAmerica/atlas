// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("FeedItemRow", () => {
  afterEach(() => {
    cleanup();
  });

  it("links an organization with a slug to its organizations profile", async () => {
    const { FeedItemRow } = await import("@/domains/catalog/components/feed/feed-item-row");
    render(
      <ul>
        <FeedItemRow
          item={{
            entry_id: "e1",
            entry_name: "Acme",
            entry_slug: "acme",
            entry_type: "organization",
            source_id: "s1",
            source_url: "https://acme.test/news",
            source_title: "Big news",
            source_publication: "Acme Times",
            ingested_at: "2024-04-01T00:00:00Z",
          }}
        />
      </ul>,
    );

    const link = screen.getByRole("link", { name: "Acme" });
    expect(link).toHaveAttribute("data-link-to", "/profiles/organizations/$slug");
    expect(link).toHaveAttribute("data-link-params", JSON.stringify({ slug: "acme" }));
    expect(screen.getByRole("link", { name: "Big news" })).toHaveAttribute(
      "href",
      "https://acme.test/news",
    );
    expect(screen.getByText(/Acme Times/)).toBeInTheDocument();
  });

  it("links a person with a slug to its people profile", async () => {
    const { FeedItemRow } = await import("@/domains/catalog/components/feed/feed-item-row");
    render(
      <ul>
        <FeedItemRow
          item={{
            entry_id: "e2",
            entry_name: "Jane",
            entry_slug: "jane",
            entry_type: "person",
            source_id: "s2",
            source_url: "https://jane.test/post",
            source_title: "Profile piece",
            source_publication: "Daily",
            ingested_at: "2024-04-02T00:00:00Z",
          }}
        />
      </ul>,
    );

    const link = screen.getByRole("link", { name: "Jane" });
    expect(link).toHaveAttribute("data-link-to", "/profiles/people/$slug");
    expect(link).toHaveAttribute("data-link-params", JSON.stringify({ slug: "jane" }));
  });

  it("renders the name as plain text and falls back to the url without a slug, title, or publication", async () => {
    const { FeedItemRow } = await import("@/domains/catalog/components/feed/feed-item-row");
    render(
      <ul>
        <FeedItemRow
          item={{
            entry_id: "e3",
            entry_name: "Anon",
            entry_slug: undefined,
            entry_type: "person",
            source_id: "s3",
            source_url: "https://anon.test/post",
            source_title: undefined,
            source_publication: undefined,
            ingested_at: "2024-04-03T00:00:00Z",
          }}
        />
      </ul>,
    );

    expect(screen.queryByRole("link", { name: "Anon" })).not.toBeInTheDocument();
    expect(screen.getByText("Anon")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "https://anon.test/post" })).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });
});
