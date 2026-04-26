// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicFooter } from "@/platform/layout/public-footer";

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
  afterEach(() => {
    cleanup();
  });

  it("hides workspace footer links in single-user mode", () => {
    render(<PublicFooter localMode status="operational" />);

    expect(screen.queryByRole("link", { name: /workspace/i })).not.toBeInTheDocument();
  });

  it("shows workspace link when not in local mode", () => {
    render(<PublicFooter localMode={false} status="operational" />);

    expect(screen.getByRole("link", { name: "Workspace" })).toHaveAttribute("href", "/discovery");
  });
});
