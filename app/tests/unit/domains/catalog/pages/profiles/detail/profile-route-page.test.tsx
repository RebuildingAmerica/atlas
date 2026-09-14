// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { isNotFound, notFound, rootRouteId } from "@tanstack/react-router";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "@rebuildingamerica/atlas-api-client";
import { ProfileRoutePage } from "@/domains/catalog/pages/profiles/detail/profile-route-page";
import { loadProfileBySlug } from "@/domains/catalog/server/profiles/profile-loaders";
import { CaptureRenderError } from "../../../../../../helpers/capture-render-error";
import { renderWithProviders } from "../../../../../../helpers/render-with-providers";
import { createEntryFixture } from "../../../../../../fixtures/catalog/entries";

vi.mock("@/domains/catalog/pages/profiles/detail/person-profile-page", () => ({
  PersonProfilePage: ({ entry }: { entry: Entry }) => <h1>Person {entry.name}</h1>,
}));

vi.mock("@/domains/catalog/pages/profiles/detail/org-profile-page", () => ({
  OrgProfilePage: ({ entry }: { entry: Entry }) => <h1>Organization {entry.name}</h1>,
}));

vi.mock("@/domains/catalog/pages/profiles/detail/non-actor-profile-page", () => ({
  NonActorProfilePage: ({ entry }: { entry: Entry }) => <h1>Record {entry.name}</h1>,
}));

vi.mock("@/domains/catalog/server/profiles/profile-loaders", () => ({
  loadEntryBySlugAny: vi.fn(),
  loadProfileBySlug: vi.fn(),
}));

describe("ProfileRoutePage", () => {
  beforeEach(() => {
    vi.mocked(loadProfileBySlug).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it.each([
    ["people", "Person Ada Reyes"],
    ["organizations", "Organization Ada Reyes"],
    ["initiatives", "Record Ada Reyes"],
  ] as const)("renders the %s profile straight from the loader entry", (scope, heading) => {
    renderWithProviders(
      <ProfileRoutePage
        scope={scope}
        slug="ada-reyes"
        entry={createEntryFixture({ name: "Ada Reyes" })}
      />,
    );

    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(loadProfileBySlug).not.toHaveBeenCalled();
  });

  it("holds the actor frame until the browser fetches a person the loader could not", async () => {
    let deliver: ((entry: Entry) => void) | undefined;
    vi.mocked(loadProfileBySlug).mockImplementation(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );

    renderWithProviders(<ProfileRoutePage scope="people" slug="ada-reyes" entry={undefined} />);

    const skeleton = screen.getByTestId("profile-page-skeleton");
    expect(skeleton).toHaveAttribute("data-layout", "actor");
    expect(screen.getByRole("status")).toHaveTextContent("Loading profile");
    expect(loadProfileBySlug).toHaveBeenCalledWith({
      data: { type: "people", slug: "ada-reyes" },
    });

    await act(async () => {
      deliver?.(createEntryFixture({ name: "Ada Reyes" }));
      await Promise.resolve();
    });

    expect(await screen.findByRole("heading", { name: "Person Ada Reyes" })).toBeInTheDocument();
    expect(screen.queryByTestId("profile-page-skeleton")).toBeNull();
  });

  it("holds the record frame for an initiative, campaign or event", () => {
    vi.mocked(loadProfileBySlug).mockReturnValue(new Promise(() => undefined));

    renderWithProviders(<ProfileRoutePage scope="events" slug="town-hall" entry={undefined} />);

    expect(screen.getByTestId("profile-page-skeleton")).toHaveAttribute("data-layout", "record");
  });

  it("keeps the frame up through a failed fetch and fills it in once the API answers", async () => {
    vi.mocked(loadProfileBySlug)
      .mockRejectedValueOnce(Object.assign(new Error("Too many requests."), { status: 429 }))
      .mockResolvedValue(createEntryFixture({ name: "Beacon Trust", type: "organization" }));

    renderWithProviders(
      <ProfileRoutePage scope="organizations" slug="beacon-trust" entry={undefined} />,
    );

    await waitFor(() => {
      expect(loadProfileBySlug).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId("profile-page-skeleton")).toBeInTheDocument();
    expect(screen.queryByText(/too many requests/i)).toBeNull();

    expect(
      await screen.findByRole("heading", { name: "Organization Beacon Trust" }, { timeout: 3_000 }),
    ).toBeInTheDocument();
    expect(loadProfileBySlug).toHaveBeenCalledTimes(2);
  });

  it("hands a profile that does not exist to the root not-found page", async () => {
    const onError = vi.fn();
    vi.mocked(loadProfileBySlug).mockRejectedValue(notFound());

    renderWithProviders(
      <CaptureRenderError onError={onError}>
        <ProfileRoutePage scope="people" slug="nobody" entry={undefined} />
      </CaptureRenderError>,
    );

    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
    const thrown: unknown = onError.mock.calls[0]?.[0];
    expect(isNotFound(thrown)).toBe(true);
    expect(thrown).toMatchObject({ routeId: rootRouteId });
    expect(loadProfileBySlug).toHaveBeenCalledOnce();
  });
});
