// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/domains/access/sso.functions", () => ({
  verifyWorkspaceSSODomain: vi.fn().mockRejectedValue(new Error("dns-not-ready")),
}));

import { useSamlDomainVerificationPoll } from "@/domains/access/components/organization/use-saml-domain-verification-poll";
import type { AtlasOrganizationDetails } from "@/domains/access/organization-contracts";

// eslint-disable-next-line atlas-tests/no-test-file-locals
function buildOrganization(): AtlasOrganizationDetails {
  return {
    sso: {
      providers: [
        {
          providerId: "saml-1",
          domainVerified: false,
          domainVerificationTokenAvailable: true,
        },
      ],
    },
  } as never;
}

describe("useSamlDomainVerificationPoll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns no timed-out providers immediately after mount", () => {
    const { result } = renderHook(() =>
      useSamlDomainVerificationPoll({
        organization: buildOrganization(),
        refreshWorkspaceData: () => Promise.resolve(),
      }),
    );
    expect(result.current.timedOutProviderIds).toEqual([]);
  });

  it("flags the pending provider as timed out after 10 minutes of failed polls", async () => {
    const { result } = renderHook(() =>
      useSamlDomainVerificationPoll({
        organization: buildOrganization(),
        refreshWorkspaceData: () => Promise.resolve(),
      }),
    );

    await act(async () => {
      vi.advanceTimersByTime(11 * 60 * 1000);
      await Promise.resolve();
    });

    expect(result.current.timedOutProviderIds).toEqual(["saml-1"]);
  });
});
