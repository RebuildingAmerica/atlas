// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupOrganizationClaimTest,
  renderOrganizationClaim,
  setupOrganizationClaimTest,
} from "./organization-claim-test-support";

describe("generic ATProto organization verification guard", () => {
  beforeEach(async () => {
    await setupOrganizationClaimTest();
  });

  afterEach(() => {
    cleanupOrganizationClaimTest();
  });

  it("does not submit a generic organization ATProto account without domain or workspace backup", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const initiateMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(claims.useInitiateClaim).mockReturnValue({
      mutateAsync: initiateMock,
      isPending: false,
    } as unknown as ReturnType<typeof claims.useInitiateClaim>);
    await renderOrganizationClaim({
      atprotoHandle: "eastsidehousing.bsky.social",
      atprotoIdentityId: "identity_1",
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit verification" }));
      await Promise.resolve();
    });

    expect(initiateMock).not.toHaveBeenCalled();
    expect(
      screen.getAllByText(
        "Add the organization domain or use a workspace where you manage this organization.",
      ),
    ).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Submit verification" })).toBeDisabled();
  });
});
