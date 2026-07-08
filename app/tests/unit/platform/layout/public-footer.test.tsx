// @vitest-environment jsdom
/* eslint-disable atlas-tests/no-test-file-locals */
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    to?: string;
    className?: string;
    "aria-label"?: string;
  }) => (
    <a
      href={props.to}
      className={props.className}
      data-router-link=""
      aria-label={props["aria-label"]}
    >
      {children}
    </a>
  ),
}));

async function renderPublicFooter(props: { localMode: boolean; status?: unknown }) {
  const { PublicFooter } = await import("@/platform/layout/public-footer");
  return render(<PublicFooter {...props} />);
}

describe("PublicFooter", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the full-viewport editorial footer frame", async () => {
    const { container } = await renderPublicFooter({ localMode: false });
    const footer = container.querySelector("footer");

    expect(footer).toHaveClass("h-[100svh]");
    expect(footer).toHaveClass("max-h-[100svh]");
    expect(footer).toHaveClass("bg-accent-deep/95");
    expect(screen.getByText("Rebuilding America Project")).toBeInTheDocument();
    expect(screen.getByText("38°54N 77°02W")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Atlas" })).toBeInTheDocument();
  });

  it("keeps public product links focused on discovery when not in local mode", async () => {
    await renderPublicFooter({ localMode: false });

    expect(screen.getByRole("link", { name: "Search" })).toHaveAttribute("href", "/browse");
    expect(screen.getByRole("link", { name: "Map" })).toHaveAttribute("href", "/map");
    expect(screen.getByRole("link", { name: "Firehose" })).toHaveAttribute("href", "/firehose");
    expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
    expect(screen.getByRole("link", { name: "Docs" })).not.toHaveAttribute("data-router-link");
    expect(screen.getByRole("link", { name: "How it works" })).toHaveAttribute(
      "href",
      "/docs/how-it-works",
    );
    expect(screen.getByRole("link", { name: "Trust & sources" })).toHaveAttribute(
      "href",
      "/docs/resources/trust",
    );
    expect(screen.getByRole("link", { name: "Open source" })).toHaveAttribute(
      "href",
      "/docs/resources/open-source",
    );
    expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "/pricing");
    expect(screen.queryByRole("link", { name: /workspace/i })).not.toBeInTheDocument();
  });

  it("hides pricing in single-user mode", async () => {
    await renderPublicFooter({ localMode: true });

    expect(screen.queryByRole("link", { name: "Pricing" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /workspace/i })).not.toBeInTheDocument();
  });

  it("anchors the footer with the Rebuilding America quote", async () => {
    await renderPublicFooter({ localMode: false });

    expect(
      screen.getByText(/Never doubt that a small group of thoughtful, committed citizens/),
    ).toBeInTheDocument();
    expect(screen.getByText("Margaret Mead")).toBeInTheDocument();
  });

  it("uses plain source language instead of banned jargon or copyright copy", async () => {
    await renderPublicFooter({ localMode: false });

    expect(screen.getByText("Public records, organized for civic discovery.")).toBeInTheDocument();
    expect(screen.queryByText(/©/)).not.toBeInTheDocument();
    expect(screen.queryByText(/copyright/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/with sources/i)).not.toBeInTheDocument();
  });
});
