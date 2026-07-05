// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PlacePage } from "@/domains/catalog/pages/place-page";
import { placePageFixture } from "@/../tests/fixtures/catalog/place-page";

describe("PlacePage", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a content-first place page without internal source or metadata jargon", () => {
    const view = render(<PlacePage data={placePageFixture} />);

    expect(screen.getByRole("heading", { level: 1, name: "Las Vegas" })).toBeInTheDocument();
    expect(screen.getByText("Clark County agenda, Jul 2")).toBeInTheDocument();
    expect(screen.getByText("Government record")).toBeInTheDocument();
    expect(screen.getByText("HUD CHAS, 2023")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "People & Organizations" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Places" })).toBeInTheDocument();

    expect(view.container).not.toHaveTextContent(/receipt/i);
    expect(view.container).not.toHaveTextContent(/source packet/i);
    expect(view.container).not.toHaveTextContent(/public bodies/i);
    expect(view.container).not.toHaveTextContent(/census:/i);
    expect(view.container).not.toHaveTextContent(/mapped signals/i);
    expect(view.container).not.toHaveTextContent(/current scope/i);
    expect(view.container).not.toHaveTextContent(/Places\s*\//i);
  });

  it("makes related places visual instead of plain text rows", () => {
    render(<PlacePage data={placePageFixture} />);

    const placesSection = screen.getByRole("heading", { name: "Places" }).closest("section");
    if (placesSection === null) {
      throw new Error("Places section was not rendered.");
    }
    const hendersonCard = within(placesSection).getByRole("link", { name: /Henderson/ });
    expect(hendersonCard).toHaveClass("bg-surface-container-lowest");
    expect(within(hendersonCard).getByTestId("place-map-thumb-Henderson")).toBeInTheDocument();
    expect(
      within(hendersonCard).getByText(
        "Housing growth, water, parks, transit access, public safety.",
      ),
    ).toBeInTheDocument();
  });
});
