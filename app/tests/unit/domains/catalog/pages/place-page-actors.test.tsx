// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaceActorList, PlaceActorSummary } from "@rebuildingamerica/atlas-api-client";
import { ActorDirectory } from "@/domains/catalog/pages/place-page-actors";

const apiMocks = vi.hoisted(() => ({
  listActors: vi.fn<(slug: string, params: unknown) => Promise<PlaceActorList>>(),
}));

vi.mock("@rebuildingamerica/atlas-api-client", () => ({
  api: { places: { listActors: apiMocks.listActors } },
}));

describe("ActorDirectory", () => {
  beforeEach(() => {
    apiMocks.listActors.mockReset();
  });

  function actor(overrides: Partial<PlaceActorSummary> = {}): PlaceActorSummary {
    return {
      description: "Transit agency",
      href: "/profiles/organizations/rtc",
      id: "actor-1",
      latest: "Final design review",
      name: "RTC Southern Nevada",
      type: "organization",
      work: "Bus service, route frequency, bus stop heat",
      ...overrides,
    };
  }

  function renderDirectory(initial: PlaceActorList) {
    return render(
      <ActorDirectory initialActors={initial} placeKind="polity" placeSlug="las-vegas-nv" />,
    );
  }

  function searchForm(container: HTMLElement): HTMLFormElement {
    const form = container.querySelector("form");
    if (!form) {
      throw new TypeError("Expected the actor directory to render a search form.");
    }
    return form;
  }

  it("shows what each actor does and where to read more", () => {
    renderDirectory({ items: [actor()] });

    expect(screen.getByRole("link", { name: "RTC Southern Nevada" })).toHaveAttribute(
      "href",
      "/profiles/organizations/rtc",
    );
    expect(screen.getByText("Transit agency")).toBeInTheDocument();
    expect(screen.getByText("Bus service, route frequency, bus stop heat")).toBeInTheDocument();
    expect(screen.getByText("Latest")).toBeInTheDocument();
    expect(screen.getByText("Final design review")).toBeInTheDocument();
  });

  it("drops the Latest panel for an actor with nothing recent on file", () => {
    renderDirectory({ items: [actor({ latest: undefined })] });

    expect(screen.queryByText("Latest")).toBeNull();
    expect(screen.getByText("Transit agency")).toBeInTheDocument();
  });

  it("says the place lists nobody rather than showing an empty grid", () => {
    renderDirectory({ items: [] });

    expect(screen.getByText("No people or organizations listed.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 0 people and organizations");
  });

  it("groups an alphabetical listing under letter headings, with a catch-all bucket", async () => {
    const user = userEvent.setup();
    apiMocks.listActors.mockResolvedValue({
      items: [
        actor({ id: "a", name: "Aardvark Civic League" }),
        actor({ id: "b", name: "Boulder Transit Riders" }),
        actor({ id: "c", name: "Aster Housing Fund" }),
        actor({ id: "d", name: "¡Adelante! Nevada" }),
      ],
    });
    renderDirectory({ items: [actor()] });

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Sort people and organizations" }),
      "name",
    );

    expect(await screen.findByRole("heading", { name: "A" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "B" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "#" })).toBeInTheDocument();
    expect(apiMocks.listActors).toHaveBeenLastCalledWith("las-vegas-nv", {
      kind: "polity",
      limit: 20,
      sort: "name",
    });
  });

  it("searches on the trimmed text a reader typed", async () => {
    const user = userEvent.setup();
    apiMocks.listActors.mockResolvedValue({
      items: [actor({ id: "hit", name: "Housing Justice Table" })],
    });
    renderDirectory({ items: [actor()] });

    await user.type(screen.getByRole("textbox"), "  housing  ");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(apiMocks.listActors).toHaveBeenCalledWith("las-vegas-nv", {
      kind: "polity",
      limit: 20,
      query: "housing",
      sort: "relevance",
    });
    expect(await screen.findByText("Housing Justice Table")).toBeInTheDocument();
  });

  it("drops the type filter again when the reader picks All", async () => {
    const user = userEvent.setup();
    apiMocks.listActors.mockResolvedValue({ items: [actor()] });
    renderDirectory({ items: [actor()] });

    await user.click(screen.getByRole("button", { name: "People" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "People" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    await user.click(screen.getByRole("button", { name: "All" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true"),
    );
    expect(apiMocks.listActors).toHaveBeenLastCalledWith("las-vegas-nv", {
      kind: "polity",
      limit: 20,
      sort: "relevance",
    });
  });

  it("appends the next page instead of replacing what the reader already saw", async () => {
    const user = userEvent.setup();
    apiMocks.listActors.mockResolvedValue({
      items: [actor({ id: "actor-2", name: "Second page org" })],
    });
    renderDirectory({ items: [actor()], nextCursor: "20" });

    await user.click(screen.getByRole("button", { name: "Show more" }));

    expect(await screen.findByText("Second page org")).toBeInTheDocument();
    expect(screen.getByText("RTC Southern Nevada")).toBeInTheDocument();
    expect(apiMocks.listActors).toHaveBeenCalledWith("las-vegas-nv", {
      cursor: "20",
      kind: "polity",
      limit: 20,
      sort: "relevance",
    });
  });

  it("keeps the visible actors and says so when the next page fails", async () => {
    const user = userEvent.setup();
    apiMocks.listActors.mockRejectedValue(new Error("network down"));
    renderDirectory({ items: [actor()], nextCursor: "20" });

    await user.click(screen.getByRole("button", { name: "Show more" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "People and organizations could not load.",
    );
    expect(screen.getByText("RTC Southern Nevada")).toBeInTheDocument();
  });

  it("ignores a slow first search that lands after a newer one", async () => {
    let resolveFirst: (value: PlaceActorList) => void = () => undefined;
    apiMocks.listActors
      .mockImplementationOnce(
        () =>
          new Promise<PlaceActorList>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValue({ items: [actor({ id: "second", name: "Newest search result" })] });
    const view = renderDirectory({ items: [actor()] });

    fireEvent.submit(searchForm(view.container));
    fireEvent.submit(searchForm(view.container));
    expect(await screen.findByText("Newest search result")).toBeInTheDocument();

    resolveFirst({ items: [actor({ id: "stale", name: "Stale search result" })] });

    await waitFor(() => {
      expect(screen.queryByText("Stale search result")).toBeNull();
    });
    expect(screen.getByText("Newest search result")).toBeInTheDocument();
  });

  it("does not raise an alert when a superseded search is the one that failed", async () => {
    let rejectFirst: (reason: Error) => void = () => undefined;
    apiMocks.listActors
      .mockImplementationOnce(
        () =>
          new Promise<PlaceActorList>((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValue({ items: [actor({ id: "second", name: "Newest search result" })] });
    const view = renderDirectory({ items: [actor()] });

    fireEvent.submit(searchForm(view.container));
    fireEvent.submit(searchForm(view.container));
    expect(await screen.findByText("Newest search result")).toBeInTheDocument();

    rejectFirst(new Error("the abandoned request finally gave up"));

    await waitFor(() => expect(screen.getByText("Newest search result")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("labels the busy state while a page is in flight", async () => {
    const user = userEvent.setup();
    let resolvePending: (value: PlaceActorList) => void = () => undefined;
    apiMocks.listActors.mockImplementation(
      () =>
        new Promise<PlaceActorList>((resolve) => {
          resolvePending = resolve;
        }),
    );
    renderDirectory({ items: [actor()], nextCursor: "20" });

    await user.click(screen.getByRole("button", { name: "Show more" }));

    expect(screen.getByRole("button", { name: "Loading" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Loading");

    resolvePending({ items: [] });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Loading" })).toBeNull();
    });
  });
});
