// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicFooter } from "@/platform/layout/public-footer";

const mocks = vi.hoisted(() => ({
  useAtlasSession: vi.fn(),
}));

vi.mock("@/domains/access", () => ({
  useAtlasSession: mocks.useAtlasSession,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    to?: string;
    className?: string;
  }) => (
    <a href={props.to} className={props.className}>
      {children}
    </a>
  ),
}));

describe("PublicFooter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useAtlasSession.mockReturnValue({ data: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("hides workspace footer links in single-user mode", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: { isLocal: true },
    });

    render(<PublicFooter status="operational" />);

    expect(screen.queryByRole("link", { name: /workspace/i })).not.toBeInTheDocument();
  });

  it("uses workspace language for signed-out visitors", () => {
    render(<PublicFooter status="operational" />);

    expect(screen.getByRole("link", { name: "Workspace" })).toHaveAttribute("href", "/discovery");
    expect(screen.queryByRole("link", { name: /sign in/i })).not.toBeInTheDocument();
  });

  it("keeps the same workspace destination for signed-in visitors", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: { isLocal: false, user: { id: "user_123" } },
    });

    render(<PublicFooter status="operational" />);

    expect(screen.getByRole("link", { name: "Workspace" })).toHaveAttribute("href", "/discovery");
  });
});
