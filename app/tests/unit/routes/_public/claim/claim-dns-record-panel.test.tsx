// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/../tests/helpers/render-with-providers";
import { ClaimDnsRecordPanel } from "@/routes/_public/claim/-claim-dns-record-panel";

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
}));

vi.mock("@/lib/clipboard", () => ({
  copyToClipboard: mocks.copyToClipboard,
}));

describe("ClaimDnsRecordPanel", () => {
  beforeEach(() => {
    mocks.copyToClipboard.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  it("copies each part of the record and confirms which one landed", async () => {
    renderWithProviders(
      <ClaimDnsRecordPanel
        dnsRecord={{
          challenge_host: "_atlas-claim.acme.org",
          challenge_value: "atlas-profile-claim=token",
          domain: "acme.org",
        }}
        isChecking={false}
        onCheck={() => Promise.resolve(true)}
      />,
    );

    expect(screen.getByText("_atlas-claim.acme.org")).toBeInTheDocument();
    expect(screen.getByText("atlas-profile-claim=token")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy Host" }));
      await Promise.resolve();
    });

    expect(mocks.copyToClipboard).toHaveBeenCalledWith("_atlas-claim.acme.org");
    expect(screen.getByRole("button", { name: "Host copied" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy TXT value" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy TXT value" }));
      await Promise.resolve();
    });

    expect(mocks.copyToClipboard).toHaveBeenLastCalledWith("atlas-profile-claim=token");
    expect(screen.getByRole("button", { name: "TXT value copied" })).toBeInTheDocument();
  });

  it("says so when the browser refused the clipboard", async () => {
    mocks.copyToClipboard.mockResolvedValue(false);
    renderWithProviders(
      <ClaimDnsRecordPanel
        dnsRecord={{ challenge_host: "_atlas-claim.acme.org" }}
        isChecking={false}
        onCheck={() => Promise.resolve(true)}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy Host" }));
      await Promise.resolve();
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not copy Host.");
    expect(screen.getByRole("button", { name: "Copy Host" })).toBeInTheDocument();
  });

  it("leaves out a part of the record the service has not issued yet", () => {
    renderWithProviders(
      <ClaimDnsRecordPanel
        dnsRecord={{ challenge_host: "_atlas-claim.acme.org" }}
        isChecking={false}
        onCheck={() => Promise.resolve(true)}
      />,
    );

    expect(screen.getByRole("button", { name: "Copy Host" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy TXT value" })).not.toBeInTheDocument();
    expect(screen.queryByText("TXT value")).not.toBeInTheDocument();
  });

  it("reports a check already in flight instead of inviting another", () => {
    renderWithProviders(
      <ClaimDnsRecordPanel
        dnsRecord={{ challenge_host: "_atlas-claim.acme.org" }}
        isChecking
        onCheck={() => Promise.resolve(true)}
      />,
    );

    expect(screen.getByRole("button", { name: "Checking..." })).toBeDisabled();
  });

  it("holds off further checks once one has completed", async () => {
    const onCheck = vi.fn(() => Promise.resolve(true));
    renderWithProviders(
      <ClaimDnsRecordPanel
        dnsRecord={{ challenge_host: "_atlas-claim.acme.org" }}
        isChecking={false}
        onCheck={onCheck}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check DNS" }));
      await Promise.resolve();
    });

    expect(onCheck).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Check again soon" })).toBeDisabled();
  });

  it("keeps inviting a check when the last one never ran", async () => {
    const onCheck = vi.fn(() => Promise.resolve(false));
    renderWithProviders(
      <ClaimDnsRecordPanel
        dnsRecord={{ challenge_host: "_atlas-claim.acme.org" }}
        isChecking={false}
        onCheck={onCheck}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check DNS" }));
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "Check DNS" })).toBeEnabled();
  });
});
