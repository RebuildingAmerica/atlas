// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorPage } from "@/platform/pages/error-page";
import { ATLAS_STATUS_PAGE_URL } from "@/platform/status/status-config";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

const mocks = vi.hoisted(() => ({
  useAtlasSession: vi.fn(),
}));

vi.mock("@/domains/access/client/use-atlas-session", () => ({
  useAtlasSession: mocks.useAtlasSession,
}));

vi.mock("@/platform/layout/public-nav", () => ({
  PublicTopNavSafe: () => <nav aria-label="Primary navigation" />,
}));

vi.mock("@/platform/layout/public-footer", () => ({
  PublicFooter: ({ localMode, status }: { localMode: boolean; status: string }) => (
    <footer data-local-mode={String(localMode)} data-status={status} />
  ),
}));

afterEach(cleanup);

describe("ErrorPage", () => {
  it("renders a balanced recovery screen with retry, status, and home actions", () => {
    const reset = vi.fn();
    mocks.useAtlasSession.mockReturnValue({ data: { isLocal: false } });

    render(<ErrorPage error={new Error("boom")} info={{ componentStack: "" }} reset={reset} />);

    expect(screen.getByRole("heading", { name: "Something went wrong." })).toBeVisible();
    expect(screen.getByText("The page could not load.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: /Check status/ })).toHaveAttribute(
      "href",
      ATLAS_STATUS_PAGE_URL,
    );
    expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", "/");
  });

  it("treats an unresolved session as hosted rather than guessing local mode", () => {
    mocks.useAtlasSession.mockReturnValue({ data: undefined });

    const { container } = render(
      <ErrorPage error={new Error("boom")} info={{ componentStack: "" }} reset={vi.fn()} />,
    );

    expect(screen.getByRole("heading", { name: "Something went wrong." })).toBeVisible();
    expect(container.querySelector("footer")).toHaveAttribute("data-local-mode", "false");
  });
});
