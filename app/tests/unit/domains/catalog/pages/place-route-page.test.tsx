// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { isNotFound } from "@tanstack/react-router";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AtlasApiError } from "@rebuildingamerica/atlas-api-client/orval/fetcher";
import { PlaceRoutePage } from "@/domains/catalog/pages/place-route-page";
import { placePageFixture } from "@/../tests/fixtures/catalog/place-page";
import { CaptureRenderError } from "@/../tests/helpers/capture-render-error";
import { renderWithProviders } from "@/../tests/helpers/render-with-providers";

const apiMocks = vi.hoisted(() => ({
  getPage: vi.fn(),
  listActors: vi.fn(),
  listLatest: vi.fn(),
}));

vi.mock("@rebuildingamerica/atlas-api-client", () => ({
  api: { places: apiMocks },
}));

describe("PlaceRoutePage", () => {
  beforeEach(() => {
    apiMocks.getPage.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the place the loader already fetched without asking again", () => {
    renderWithProviders(
      <PlaceRoutePage loaderData={placePageFixture} params={{ placeSlug: "las-vegas-nv" }} />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Las Vegas" })).toBeInTheDocument();
    expect(apiMocks.getPage).not.toHaveBeenCalled();
  });

  it("shows the page layout with placeholders, then the place once the browser fetch lands", async () => {
    apiMocks.getPage.mockResolvedValue(placePageFixture);

    renderWithProviders(
      <PlaceRoutePage
        loaderData={undefined}
        options={{ kind: "city" }}
        params={{ placeSlug: "las-vegas-nv" }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Loading this place");
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("navigation", { name: "Place sections" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "People & Organizations" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Government" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    expect(await screen.findByRole("heading", { level: 1, name: "Las Vegas" })).toBeInTheDocument();
    expect(apiMocks.getPage).toHaveBeenCalledWith("las-vegas-nv", { kind: "city" });
  });

  it("keeps the placeholders up through a failure and never shows its text", async () => {
    apiMocks.getPage
      .mockRejectedValueOnce(new AtlasApiError(429, "rate limit exceeded for 10.0.0.1"))
      .mockResolvedValue(placePageFixture);

    renderWithProviders(
      <PlaceRoutePage loaderData={undefined} params={{ placeSlug: "las-vegas-nv" }} />,
    );

    await waitFor(() => {
      expect(apiMocks.getPage).toHaveBeenCalledOnce();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Loading this place");
    expect(screen.queryByText(/rate limit|Too many|busy/i)).not.toBeInTheDocument();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Las Vegas" }, { timeout: 3_000 }),
    ).toBeInTheDocument();
    expect(apiMocks.getPage).toHaveBeenLastCalledWith("las-vegas-nv");
  });

  it("renders not-found when the browser fetch learns the place does not exist", async () => {
    const onError = vi.fn();
    apiMocks.getPage.mockRejectedValue(new AtlasApiError(404, "Place not found"));

    renderWithProviders(
      <CaptureRenderError onError={onError}>
        <PlaceRoutePage loaderData={undefined} params={{ placeSlug: "atlantis" }} />
      </CaptureRenderError>,
    );

    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
    expect(isNotFound(onError.mock.calls[0]?.[0])).toBe(true);
    expect(apiMocks.getPage).toHaveBeenCalledOnce();
  });
});
