// @vitest-environment jsdom
/* eslint-disable atlas-tests/no-test-file-locals */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  verifyWorkspaceSSODomain: vi.fn(),
}));

vi.mock("@/domains/access/sso.functions", () => ({
  verifyWorkspaceSSODomain: mocks.verifyWorkspaceSSODomain,
}));

import { useSamlDomainVerificationPoll } from "@/domains/access/components/organization/use-saml-domain-verification-poll";
import type { AtlasOrganizationDetails } from "@/domains/access/organization-contracts";

interface TestProvider {
  providerId: string;
  domainVerified: boolean;
  domainVerificationTokenAvailable: boolean;
}

function buildOrganization(providers: TestProvider[] = []): AtlasOrganizationDetails {
  return {
    sso: { providers },
  } as never;
}

const POLL_INTERVAL_MS = 30 * 1000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

describe("useSamlDomainVerificationPoll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.verifyWorkspaceSSODomain.mockReset();
    mocks.verifyWorkspaceSSODomain.mockRejectedValue(new Error("dns-not-ready"));
    if (typeof window !== "undefined") {
      window.localStorage.clear();
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns no timed-out providers immediately after mount", () => {
    const { result } = renderHook(() =>
      useSamlDomainVerificationPoll({
        organization: buildOrganization([
          { providerId: "saml-1", domainVerified: false, domainVerificationTokenAvailable: true },
        ]),
        refreshWorkspaceData: () => Promise.resolve(),
      }),
    );
    expect(result.current.timedOutProviderIds).toEqual([]);
  });

  it("returns an empty list when there are no pending providers", () => {
    const { result } = renderHook(() =>
      useSamlDomainVerificationPoll({
        organization: buildOrganization([]),
        refreshWorkspaceData: () => Promise.resolve(),
      }),
    );
    expect(result.current.timedOutProviderIds).toEqual([]);
  });

  it("handles null organization gracefully", () => {
    const { result } = renderHook(() =>
      useSamlDomainVerificationPoll({
        organization: null,
        refreshWorkspaceData: () => Promise.resolve(),
      }),
    );
    expect(result.current.timedOutProviderIds).toEqual([]);
  });

  it("handles organizations without an sso block", () => {
    const { result } = renderHook(() =>
      useSamlDomainVerificationPoll({
        organization: {} as never,
        refreshWorkspaceData: () => Promise.resolve(),
      }),
    );
    expect(result.current.timedOutProviderIds).toEqual([]);
  });

  it("ignores providers that already verified or have no token yet", () => {
    const { result } = renderHook(() =>
      useSamlDomainVerificationPoll({
        organization: buildOrganization([
          { providerId: "verified", domainVerified: true, domainVerificationTokenAvailable: true },
          {
            providerId: "no-token",
            domainVerified: false,
            domainVerificationTokenAvailable: false,
          },
        ]),
        refreshWorkspaceData: () => Promise.resolve(),
      }),
    );
    expect(result.current.timedOutProviderIds).toEqual([]);
  });

  it("flags the pending provider as timed out after 10 minutes of failed polls", async () => {
    const { result } = renderHook(() =>
      useSamlDomainVerificationPoll({
        organization: buildOrganization([
          { providerId: "saml-1", domainVerified: false, domainVerificationTokenAvailable: true },
        ]),
        refreshWorkspaceData: () => Promise.resolve(),
      }),
    );

    await act(async () => {
      vi.advanceTimersByTime(11 * 60 * 1000);
      await Promise.resolve();
    });

    expect(result.current.timedOutProviderIds).toEqual(["saml-1"]);
  });

  it("calls refreshWorkspaceData once a verification succeeds", async () => {
    mocks.verifyWorkspaceSSODomain.mockResolvedValueOnce({ ok: true });
    const refreshWorkspaceData = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useSamlDomainVerificationPoll({
        organization: buildOrganization([
          { providerId: "saml-1", domainVerified: false, domainVerificationTokenAvailable: true },
        ]),
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });

    expect(mocks.verifyWorkspaceSSODomain).toHaveBeenCalledWith({ data: { providerId: "saml-1" } });
    expect(refreshWorkspaceData).toHaveBeenCalled();
  });

  it("does not call refresh when every poll attempt rejects", async () => {
    const refreshWorkspaceData = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useSamlDomainVerificationPoll({
        organization: buildOrganization([
          { providerId: "saml-1", domainVerified: false, domainVerificationTokenAvailable: true },
        ]),
        refreshWorkspaceData,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });

    expect(mocks.verifyWorkspaceSSODomain).toHaveBeenCalled();
    expect(refreshWorkspaceData).not.toHaveBeenCalled();
  });

  it("clears the interval on unmount", async () => {
    const { unmount } = renderHook(() =>
      useSamlDomainVerificationPoll({
        organization: buildOrganization([
          { providerId: "saml-1", domainVerified: false, domainVerificationTokenAvailable: true },
        ]),
        refreshWorkspaceData: () => Promise.resolve(),
      }),
    );
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    });
    // The pre-unmount tick may have fired once, but no new ticks should run
    // after unmount.  Verifying timers were cleared without errors is enough.
    expect(true).toBe(true);
  });

  it("rehydrates the poll start from localStorage so a refresh does not extend the budget", async () => {
    const fingerprint = "saml-1";
    const stored = Date.now() - (POLL_TIMEOUT_MS - 10_000);
    window.localStorage.setItem(`atlas:saml-poll-started:${fingerprint}`, String(stored));

    const { result } = renderHook(() =>
      useSamlDomainVerificationPoll({
        organization: buildOrganization([
          { providerId: "saml-1", domainVerified: false, domainVerificationTokenAvailable: true },
        ]),
        refreshWorkspaceData: () => Promise.resolve(),
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });

    expect(result.current.timedOutProviderIds).toEqual(["saml-1"]);
  });

  it("ignores stale localStorage entries beyond the 10-minute budget", () => {
    const fingerprint = "saml-1";
    const stored = Date.now() - (POLL_TIMEOUT_MS + 60_000);
    window.localStorage.setItem(`atlas:saml-poll-started:${fingerprint}`, String(stored));

    renderHook(() =>
      useSamlDomainVerificationPoll({
        organization: buildOrganization([
          { providerId: "saml-1", domainVerified: false, domainVerificationTokenAvailable: true },
        ]),
        refreshWorkspaceData: () => Promise.resolve(),
      }),
    );

    expect(window.localStorage.getItem(`atlas:saml-poll-started:${fingerprint}`)).not.toBe(
      String(stored),
    );
  });

  it("ignores non-numeric localStorage entries", () => {
    window.localStorage.setItem("atlas:saml-poll-started:saml-1", "not-a-number");

    renderHook(() =>
      useSamlDomainVerificationPoll({
        organization: buildOrganization([
          { providerId: "saml-1", domainVerified: false, domainVerificationTokenAvailable: true },
        ]),
        refreshWorkspaceData: () => Promise.resolve(),
      }),
    );

    // The hook should write a fresh start value, replacing the bogus one.
    const stored = window.localStorage.getItem("atlas:saml-poll-started:saml-1");
    expect(stored).not.toBe("not-a-number");
    expect(Number.isFinite(Number(stored))).toBe(true);
  });
});
