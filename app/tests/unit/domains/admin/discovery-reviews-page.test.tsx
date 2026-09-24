// @vitest-environment jsdom
/* eslint-disable atlas-tests/no-test-file-locals */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscoveryReviewsPage } from "@/domains/admin/discovery-reviews-page";
import type { DiscoveryReviewPage } from "@/domains/admin/discovery-reviews.functions";

const mocks = vi.hoisted(() => ({
  decideDiscoveryReview: vi.fn(),
  listDiscoveryReviews: vi.fn(),
  prepareLasVegasWebsiteReviews: vi.fn(),
  useHydrated: vi.fn(() => true),
}));

vi.mock("@/domains/admin/discovery-reviews.functions", () => ({
  decideDiscoveryReview: mocks.decideDiscoveryReview,
  listDiscoveryReviews: mocks.listDiscoveryReviews,
  prepareLasVegasWebsiteReviews: mocks.prepareLasVegasWebsiteReviews,
}));

vi.mock("@/platform/runtime/use-hydrated", () => ({ useHydrated: mocks.useHydrated }));

const page: DiscoveryReviewPage = {
  items: [
    {
      changes: [{ before: "Old", after: "New", field: "description" }],
      entityName: "Civic Group",
      entitySlug: "civic-group",
      entityType: "organization",
      holdReason: "published_profile_change",
      id: "7cb2c69a-f22b-4f4e-ab83-16872c9fd59e",
      sourceUrls: ["https://example.org/about"],
    },
  ],
  total: 1,
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DiscoveryReviewsPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.decideDiscoveryReview.mockReset();
  mocks.listDiscoveryReviews.mockReset();
  mocks.prepareLasVegasWebsiteReviews.mockReset();
  mocks.useHydrated.mockReset();
  mocks.useHydrated.mockReturnValue(true);
});

describe("DiscoveryReviewsPage", () => {
  it("renders the admin shell while the private queue is pending", () => {
    mocks.listDiscoveryReviews.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByRole("heading", { name: "Discovered profiles" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Pending discovery reviews" })).toBeInTheDocument();
  });

  it("loads reviewed facts, pages, and submits an attested decision", async () => {
    mocks.listDiscoveryReviews.mockResolvedValue({ ...page, total: 26 });
    mocks.decideDiscoveryReview.mockResolvedValue({ id: page.items[0]?.id, status: "approved" });
    renderPage();

    expect(await screen.findByText("Civic Group")).toBeInTheDocument();
    expect(mocks.listDiscoveryReviews).toHaveBeenCalledWith({ data: { offset: 0 } });
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked these sources/ }));
    fireEvent.click(screen.getByRole("button", { name: "Approve Civic Group" }));
    await waitFor(() => {
      expect(mocks.decideDiscoveryReview.mock.calls[0]?.[0]).toEqual({
        data: { decision: "approve", itemId: page.items[0]?.id },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Next reviews" }));
    expect(mocks.listDiscoveryReviews).toHaveBeenCalledWith({ data: { offset: 25 } });
  });

  it("prepares Las Vegas website proposals and refreshes the review queue", async () => {
    mocks.listDiscoveryReviews.mockResolvedValue({ items: [], total: 0 });
    mocks.prepareLasVegasWebsiteReviews.mockResolvedValue({ enqueued: 2 });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Find Las Vegas website candidates" }));

    await waitFor(() => {
      expect(mocks.prepareLasVegasWebsiteReviews).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("2 website proposals ready for review.")).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.listDiscoveryReviews).toHaveBeenCalledTimes(2);
    });
  });

  it("states when the website scan finds no new proposals", async () => {
    mocks.listDiscoveryReviews.mockResolvedValue({ items: [], total: 0 });
    mocks.prepareLasVegasWebsiteReviews.mockResolvedValue({ enqueued: 0 });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Find Las Vegas website candidates" }));

    expect(await screen.findByText("No new website proposals.")).toBeInTheDocument();
  });

  it("uses a singular count for one website proposal", async () => {
    mocks.listDiscoveryReviews.mockResolvedValue({ items: [], total: 0 });
    mocks.prepareLasVegasWebsiteReviews.mockResolvedValue({ enqueued: 1 });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Find Las Vegas website candidates" }));

    expect(await screen.findByText("1 website proposal ready for review.")).toBeInTheDocument();
  });

  it("keeps the review queue available when website preparation fails", async () => {
    mocks.listDiscoveryReviews.mockResolvedValue(page);
    mocks.prepareLasVegasWebsiteReviews.mockRejectedValue(new Error("API down"));
    renderPage();
    expect(await screen.findByText("Civic Group")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Find Las Vegas website candidates" }));

    expect(
      await screen.findByText("Website candidates could not be prepared."),
    ).toBeInTheDocument();
    expect(screen.getByText("Civic Group")).toBeInTheDocument();
  });

  it("shows a safe load error", async () => {
    mocks.listDiscoveryReviews.mockRejectedValue(new Error("API down"));
    renderPage();
    expect(await screen.findByText("Discovery reviews could not load.")).toBeInTheDocument();
  });

  it("shows a decision failure without dropping the review", async () => {
    mocks.listDiscoveryReviews.mockResolvedValue(page);
    mocks.decideDiscoveryReview.mockRejectedValue(new Error("Conflict"));
    renderPage();
    expect(await screen.findByText("Civic Group")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reject Civic Group" }));
    expect(
      await screen.findByText("Decision could not be saved. Reload and review the current facts."),
    ).toBeInTheDocument();
    expect(screen.getByText("Civic Group")).toBeInTheDocument();
  });

  it("marks an in-flight decision as pending", async () => {
    mocks.listDiscoveryReviews.mockResolvedValue(page);
    mocks.decideDiscoveryReview.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(await screen.findByText("Civic Group")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reject Civic Group" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reject Civic Group" })).toBeDisabled();
    });
  });

  it("does not request the queue before hydration", () => {
    mocks.useHydrated.mockReturnValue(false);
    renderPage();
    expect(mocks.listDiscoveryReviews).not.toHaveBeenCalled();
  });
});
