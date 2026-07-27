// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaceLatestItem, PlaceLatestList } from "@rebuildingamerica/atlas-api-client";
import { LatestFeed } from "@/domains/catalog/pages/place-page-latest";

const apiMocks = vi.hoisted(() => ({
  listLatest: vi.fn<(slug: string, params: unknown) => Promise<PlaceLatestList>>(),
}));

vi.mock("@rebuildingamerica/atlas-api-client", () => ({
  api: { places: { listLatest: apiMocks.listLatest } },
}));

describe("LatestFeed", () => {
  beforeEach(() => {
    apiMocks.listLatest.mockReset();
  });

  function item(overrides: Partial<PlaceLatestItem> = {}): PlaceLatestItem {
    return {
      attribution: "Clark County agenda, Jul 2",
      dateLabel: "Jul 2",
      excerpt: "East-west routes were named in public comment.",
      href: "https://example.test/agenda",
      id: "latest-1",
      linkedActors: [
        { href: "/profiles/organizations/rtc", id: "actor-1", name: "RTC Southern Nevada" },
      ],
      linkedEntityIds: ["actor-1"],
      sourceType: "government_record",
      title: "Commissioners advance bus stop shade funding",
      topics: ["Transit"],
      ...overrides,
    };
  }

  function renderFeed(initial: PlaceLatestList) {
    return render(
      <LatestFeed initialLatest={initial} placeKind="polity" placeSlug="las-vegas-nv" />,
    );
  }

  it("shows a reader what each activity item is, when, and who it names", () => {
    renderFeed({ items: [item()] });

    expect(screen.getByText("Government record")).toBeInTheDocument();
    expect(screen.getByText("Jul 2")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Commissioners advance bus stop shade funding/ }),
    ).toHaveAttribute("href", "https://example.test/agenda");
    expect(screen.getByText("East-west routes were named in public comment.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "RTC Southern Nevada" })).toHaveAttribute(
      "href",
      "/profiles/organizations/rtc",
    );
    expect(screen.getByText("Transit")).toBeInTheDocument();
  });

  it("omits the optional detail chips an item has nothing to put in", () => {
    renderFeed({
      items: [
        item({
          dateLabel: undefined,
          excerpt: undefined,
          linkedActors: [],
          linkedEntityIds: [],
          topics: [],
        }),
      ],
    });

    expect(screen.queryByText("Jul 2")).toBeNull();
    expect(screen.queryByText("East-west routes were named in public comment.")).toBeNull();
    expect(screen.queryByRole("link", { name: "RTC Southern Nevada" })).toBeNull();
    expect(screen.queryByText("Transit")).toBeNull();
  });

  it("says the place has no recent activity rather than showing a bare list", () => {
    renderFeed({ items: [] });

    expect(screen.getByText("No recent activity listed.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 0 latest activity items");
  });

  it("searches on the trimmed text a reader typed", async () => {
    const user = userEvent.setup();
    apiMocks.listLatest.mockResolvedValue({ items: [item({ id: "hit", title: "Rent report" })] });
    renderFeed({ items: [item()] });

    await user.type(screen.getByRole("textbox"), "  rent  ");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(apiMocks.listLatest).toHaveBeenCalledWith("las-vegas-nv", {
      cursor: undefined,
      kind: "polity",
      limit: 10,
      query: "rent",
      sourceTypes: undefined,
    });
    expect(await screen.findByText("Rent report")).toBeInTheDocument();
  });

  it("drops the source filter again when the reader picks All", async () => {
    const user = userEvent.setup();
    apiMocks.listLatest.mockResolvedValue({ items: [item()] });
    renderFeed({ items: [item()] });

    await user.click(screen.getByRole("button", { name: "Reports" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Reports" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    await user.click(screen.getByRole("button", { name: "All" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true"),
    );
    expect(apiMocks.listLatest).toHaveBeenLastCalledWith("las-vegas-nv", {
      cursor: undefined,
      kind: "polity",
      limit: 10,
      query: undefined,
      sourceTypes: undefined,
    });
  });

  it("appends the next page instead of replacing what the reader already saw", async () => {
    const user = userEvent.setup();
    apiMocks.listLatest.mockResolvedValue({
      items: [item({ id: "latest-2", title: "Second page item" })],
    });
    renderFeed({ items: [item()], nextCursor: "10" });

    await user.click(screen.getByRole("button", { name: "Show more" }));

    expect(await screen.findByText("Second page item")).toBeInTheDocument();
    expect(screen.getByText("Commissioners advance bus stop shade funding")).toBeInTheDocument();
    expect(apiMocks.listLatest).toHaveBeenCalledWith("las-vegas-nv", {
      cursor: "10",
      kind: "polity",
      limit: 10,
      query: undefined,
      sourceTypes: undefined,
    });
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("keeps the visible items and says so when the next page fails", async () => {
    const user = userEvent.setup();
    apiMocks.listLatest.mockRejectedValue(new Error("network down"));
    renderFeed({ items: [item()], nextCursor: "10" });

    await user.click(screen.getByRole("button", { name: "Show more" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Latest activity could not load.");
    expect(screen.getByText("Commissioners advance bus stop shade funding")).toBeInTheDocument();
  });

  it("ignores a slow first search that lands after a newer one", async () => {
    let resolveFirst: (value: PlaceLatestList) => void = () => undefined;
    apiMocks.listLatest
      .mockImplementationOnce(
        () =>
          new Promise<PlaceLatestList>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue({ items: [item({ id: "second", title: "Newest search result" })] });
    const view = renderFeed({ items: [item()] });
    const form = view.container.querySelector("form");
    if (!form) {
      throw new TypeError("Expected the latest feed to render a search form.");
    }

    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(await screen.findByText("Newest search result")).toBeInTheDocument();

    resolveFirst({ items: [item({ id: "stale", title: "Stale search result" })] });

    await waitFor(() => {
      expect(screen.queryByText("Stale search result")).toBeNull();
    });
    expect(screen.getByText("Newest search result")).toBeInTheDocument();
  });

  it("does not raise an alert when a superseded search is the one that failed", async () => {
    let rejectFirst: (reason: Error) => void = () => undefined;
    apiMocks.listLatest
      .mockImplementationOnce(
        () =>
          new Promise<PlaceLatestList>((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValue({ items: [item({ id: "second", title: "Newest search result" })] });
    const view = renderFeed({ items: [item()] });
    const form = view.container.querySelector("form");
    if (!form) {
      throw new TypeError("Expected the latest feed to render a search form.");
    }

    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(await screen.findByText("Newest search result")).toBeInTheDocument();

    rejectFirst(new Error("the abandoned request finally gave up"));

    await waitFor(() => expect(screen.getByText("Newest search result")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("labels the busy state while a page is in flight", async () => {
    const user = userEvent.setup();
    let resolvePending: (value: PlaceLatestList) => void = () => undefined;
    apiMocks.listLatest.mockImplementation(
      () =>
        new Promise<PlaceLatestList>((resolve) => {
          resolvePending = resolve;
        }),
    );
    const view = renderFeed({ items: [item()], nextCursor: "10" });

    await user.click(screen.getByRole("button", { name: "Show more" }));

    expect(within(view.container).getByRole("button", { name: "Loading" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Loading");

    resolvePending({ items: [] });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Loading" })).toBeNull();
    });
  });
});
