// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthFlowLayout } from "@/platform/layout/auth-layout";

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

vi.mock("@/platform/layout/civic-map-panel", () => ({
  CivicMapPanel: () => <div data-testid="civic-map-panel" />,
}));

describe("AuthFlowLayout", () => {
  afterEach(() => {
    cleanup();
  });

  it("wraps the form surface in a main landmark", () => {
    render(
      <AuthFlowLayout>
        <form aria-label="Sign in form" />
      </AuthFlowLayout>,
    );

    const main = screen.getByRole("main");
    expect(main).toContainElement(screen.getByRole("form", { name: "Sign in form" }));
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });
});
