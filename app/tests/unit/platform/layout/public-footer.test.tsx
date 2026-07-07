// @vitest-environment jsdom
/* eslint-disable atlas-tests/no-test-file-locals */
import type { Status } from "@openstatus/react";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ATLAS_STATUS_MONITOR_ID, ATLAS_STATUS_PAGE_URL } from "@/platform/status/status-config";

vi.mock("@openstatus/react", () => ({
  getStatus: vi.fn(),
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
    <a href={props.to} className={props.className} data-router-link="">
      {children}
    </a>
  ),
}));

async function renderPublicFooter(props: { localMode: boolean; status?: Status }) {
  const { PublicFooter } = await import("@/platform/layout/public-footer");
  return render(<PublicFooter {...props} />);
}

async function mockOpenStatus(status: Status = "operational") {
  const { getStatus } = await import("@openstatus/react");
  vi.mocked(getStatus).mockResolvedValue({
    status,
  });
  return getStatus;
}

describe("PublicFooter", () => {
  beforeEach(async () => {
    vi.resetModules();
    await mockOpenStatus();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("hides workspace footer links in single-user mode", async () => {
    await renderPublicFooter({ localMode: true });

    expect(screen.queryByRole("link", { name: /workspace/i })).not.toBeInTheDocument();
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
    expect(screen.getByRole("link", { name: "How it works" })).not.toHaveAttribute(
      "data-router-link",
    );
    expect(screen.getByRole("link", { name: "Trust & sources" })).toHaveAttribute(
      "href",
      "/docs/resources/trust",
    );
    expect(screen.getByRole("link", { name: "Trust & sources" })).not.toHaveAttribute(
      "data-router-link",
    );
    expect(screen.getByRole("link", { name: "Open source" })).toHaveAttribute(
      "href",
      "/docs/resources/open-source",
    );
    expect(screen.getByRole("link", { name: "Open source" })).not.toHaveAttribute(
      "data-router-link",
    );
    expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "/pricing");
    expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute("data-router-link");
    expect(screen.queryByRole("link", { name: /workspace/i })).not.toBeInTheDocument();
  });

  it("describes Atlas as source-linked local civic intelligence", async () => {
    await renderPublicFooter({ localMode: false });

    expect(
      screen.getByText("Source-linked local civic intelligence for the issues that matter most."),
    ).toBeInTheDocument();
  });

  it("renders immediately with an unknown status while the probe is pending", async () => {
    const { getStatus } = await import("@openstatus/react");
    vi.mocked(getStatus).mockReturnValue(new Promise(() => undefined));

    await renderPublicFooter({ localMode: false });

    expect(screen.getByRole("link", { name: /Status unavailable/i })).toBeInTheDocument();
    expect(getStatus).toHaveBeenCalledWith(ATLAS_STATUS_MONITOR_ID);
    expect(screen.getByRole("link", { name: /Status unavailable/i })).toHaveAttribute(
      "href",
      ATLAS_STATUS_PAGE_URL,
    );
  });

  it("updates the status after the footer probe resolves", async () => {
    await renderPublicFooter({ localMode: false });

    expect(
      await screen.findByRole("link", { name: /All systems operational/i }),
    ).toBeInTheDocument();
  });
});
