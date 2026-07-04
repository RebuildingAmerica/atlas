// @vitest-environment jsdom
/* eslint-disable atlas-tests/no-test-file-locals */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscountVerificationSection } from "@/domains/billing/verification/discount-verification-section";

interface FetchResponse {
  json: () => Promise<unknown>;
  ok: boolean;
}

function renderDiscountVerificationSection() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <DiscountVerificationSection userId="user_123" />
    </QueryClientProvider>,
  );
}

function mockFetch(response: FetchResponse): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DiscountVerificationSection", () => {
  it("announces submitted verification requests as a status", async () => {
    mockFetch({
      json: () => Promise.resolve({ ok: true }),
      ok: true,
    });
    renderDiscountVerificationSection();

    fireEvent.click(screen.getByRole("button", { name: /Independent Journalist/i }));
    fireEvent.change(screen.getByLabelText("Portfolio or Byline URL"), {
      target: { value: "https://example.org/byline" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request Verification" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Verification submitted");
    });
  });

  it("announces failed verification requests as an alert", async () => {
    mockFetch({
      json: () => Promise.resolve({ detail: "Verification failed" }),
      ok: false,
    });
    renderDiscountVerificationSection();

    fireEvent.click(screen.getByRole("button", { name: /Independent Journalist/i }));
    fireEvent.change(screen.getByLabelText("Portfolio or Byline URL"), {
      target: { value: "https://example.org/byline" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request Verification" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Verification failed");
    });
  });
});
