// @vitest-environment jsdom
/* eslint-disable atlas-tests/no-test-file-locals */
import type { Status } from "@openstatus/react";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    <a href={props.to} className={props.className}>
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
  } as Awaited<ReturnType<typeof getStatus>>);
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
    await renderPublicFooter({ localMode: true, status: "operational" });

    expect(screen.queryByRole("link", { name: /workspace/i })).not.toBeInTheDocument();
  });

  it("shows workspace link when not in local mode", async () => {
    await renderPublicFooter({ localMode: false, status: "operational" });

    expect(screen.getByRole("link", { name: "Workspace" })).toHaveAttribute("href", "/discovery");
  });

  it("describes Atlas as source-linked local civic intelligence", async () => {
    await renderPublicFooter({ localMode: false, status: "operational" });

    expect(
      screen.getByText("Source-linked local civic intelligence for the issues that matter most."),
    ).toBeInTheDocument();
  });

  it("renders immediately with an unknown status while the probe is pending", async () => {
    const { getStatus } = await import("@openstatus/react");
    vi.mocked(getStatus).mockReturnValue(new Promise(() => undefined));

    await renderPublicFooter({ localMode: false });

    expect(screen.getByRole("link", { name: /Status unavailable/i })).toBeInTheDocument();
    expect(getStatus).toHaveBeenCalledWith("atlasapp");
  });

  it("updates the status after the footer probe resolves", async () => {
    await renderPublicFooter({ localMode: false });

    expect(
      await screen.findByRole("link", { name: /All systems operational/i }),
    ).toBeInTheDocument();
  });
});
