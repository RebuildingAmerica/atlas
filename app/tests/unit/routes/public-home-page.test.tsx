// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomePage } from "@/platform/pages/home-page";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useAtlasSession: vi.fn(),
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

vi.mock("@/domains/access/client/use-atlas-session", () => ({
  atlasSessionQueryKey: ["auth", "session"],
  useAtlasSession: mocks.useAtlasSession,
}));

describe("HomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.navigate.mockResolvedValue(undefined);
    mocks.useAtlasSession.mockReturnValue({ data: null, isLoading: false });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the verify-instead-of-save copy when running in local mode", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: { isLocal: true },
      isLoading: false,
    });
    render(<HomePage />);
    expect(screen.getByText("Verify")).toBeInTheDocument();
    expect(screen.getByText("Every entry links back to public sources.")).toBeInTheDocument();
    expect(screen.queryByText(/Want to save your work\?/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Go to your research/ })).not.toBeInTheDocument();
  });

  it("renders the create-account prompt for anonymous visitors", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: null,
      isLoading: false,
    });
    render(<HomePage />);
    expect(screen.getByText("Save")).toBeInTheDocument();
    expect(screen.getByText("Create a free account to save research.")).toBeInTheDocument();
    expect(screen.getByText(/Want to save your work\?/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Create a free account/ })).toHaveAttribute(
      "href",
      "/sign-up",
    );
    expect(screen.queryByRole("link", { name: /Go to your research/ })).not.toBeInTheDocument();
  });

  it("frames Atlas as source-linked local intelligence on the public home page", () => {
    render(<HomePage />);

    expect(screen.getByText(/source-linked local intelligence/i)).toBeInTheDocument();
    expect(screen.queryByText(/profile directories/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/broader civic graph/i)).not.toBeInTheDocument();
  });

  it("invites signed-in visitors to their research base", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: { isLocal: false },
      isLoading: false,
    });
    render(<HomePage />);
    expect(screen.queryByText(/Want to save your work\?/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Create a free account/ })).not.toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /Go to your research/ });
    expect(cta).toHaveAttribute("href", "/home");
  });

  it("submits browse searches with a normal GET form", async () => {
    mocks.navigate.mockRejectedValue(new Error("Router blew up"));

    render(<HomePage />);

    const searchInput = screen.getByRole("textbox", {
      name: "Search Atlas by issue, place, or name",
    });
    const form = screen.getByRole("button", { name: /search atlas/i }).closest("form");
    if (!form) {
      throw new Error("Expected search form");
    }

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "housing" } });
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
