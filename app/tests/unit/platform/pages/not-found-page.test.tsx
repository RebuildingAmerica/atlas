// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useAtlasSession: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access", () => ({
  useAtlasSession: mocks.useAtlasSession,
}));

vi.mock("@/domains/access/client/use-atlas-session", () => ({
  useAtlasSession: mocks.useAtlasSession,
}));

describe("NotFoundPage", () => {
  beforeEach(async () => {
    const { resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    mocks.useAtlasSession.mockReturnValue({ data: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("explains the page is missing and offers a way back into Atlas", async () => {
    const { NotFoundPage } = await import("@/platform/pages/not-found-page");

    render(<NotFoundPage />);

    expect(screen.getByText("404 · Page not found")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("We lost the map");
    expect(screen.getByRole("link", { name: "← Back to home" })).toHaveAttribute(
      "data-link-to",
      "/",
    );
    expect(screen.getByRole("link", { name: "Browse entries" })).toHaveAttribute(
      "data-link-to",
      "/browse",
    );
  });

  it("keeps the public chrome around the missing page", async () => {
    const { NotFoundPage } = await import("@/platform/pages/not-found-page");

    const { container } = render(<NotFoundPage />);

    const banner = container.querySelector("header");
    if (!banner) throw new Error("Expected the missing page to keep the public header.");
    // The nav is rendered in its session-free form: a 404 is no place to ask
    // the reader to sign in.
    expect(within(banner).queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(within(banner).queryByRole("searchbox")).toBeNull();
    expect(container.querySelector("footer")).not.toBeNull();
    expect(screen.getByText("Rebuilding America Project")).toBeInTheDocument();
  });

  it("keeps the footer in local mode when the session says so", async () => {
    mocks.useAtlasSession.mockReturnValue({ data: { isLocal: true } });
    const { NotFoundPage } = await import("@/platform/pages/not-found-page");

    render(<NotFoundPage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("We lost the map");
  });
});
