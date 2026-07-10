// @vitest-environment jsdom
/* eslint-disable atlas-tests/no-test-file-locals */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscountAdminPage } from "@/domains/billing/pages/workspace/discount-admin-page";
import type { VerificationListResponse } from "@/lib/generated/atlas-schemas/access/verificationListResponse";

const verificationListResponse: VerificationListResponse = {
  records: [
    {
      id: "verif_123",
      method: "portfolio",
      notes: "Pending review",
      organization_id: "org_123",
      segment: "independent_journalist",
      status: "pending",
      submitted_at: "2026-07-01T12:00:00.000Z",
      user_id: "user_123",
      verification_data: { portfolioUrl: "https://example.org/byline" },
      verified_at: null,
    },
  ],
  total: 1,
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function renderDiscountAdminPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <DiscountAdminPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DiscountAdminPage", () => {
  it("links verification records by verification id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(verificationListResponse, 200)),
    );

    renderDiscountAdminPage();

    const detailLink = await screen.findByRole("link", { name: "View details" });
    expect(detailLink).toHaveAttribute("href", "/admin/verifications/verif_123");
  });

  it("approves pending verification records by verification id", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(verificationListResponse, 200))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            message: "Verification review updated.",
            record: {
              ...verificationListResponse.records[0],
              status: "verified",
              verified_at: "2026-07-02T12:00:00.000Z",
            },
            status: "verified",
          },
          200,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ ...verificationListResponse, records: [] }, 200));
    vi.stubGlobal("fetch", fetchMock);

    renderDiscountAdminPage();

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/verifications/verif_123",
        expect.objectContaining({
          method: "PATCH",
        }),
      );
    });
  });
});
