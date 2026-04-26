// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomePage } from "@/platform/pages/home-page";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
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
  createFileRoute: () => (_options: unknown) => _options,
  useNavigate: () => mocks.navigate,
}));

describe("HomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.navigate.mockResolvedValue(undefined);
  });

  it("submits browse searches with a normal GET form", async () => {
    mocks.navigate.mockRejectedValue(new Error("Router blew up"));

    render(<HomePage />);

    const form = screen.getByRole("button", { name: /search atlas/i }).closest("form");
    if (!form) {
      throw new Error("Expected search form");
    }

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/search housing in detroit/i), {
        target: { value: "housing" },
      });
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(form).toHaveAttribute("action", "/browse");
    expect(form).toHaveAttribute("method", "get");
    expect(screen.getByDisplayValue("housing")).toHaveAttribute("name", "query");
    expect(screen.getByDisplayValue("0")).toHaveAttribute("name", "offset");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
