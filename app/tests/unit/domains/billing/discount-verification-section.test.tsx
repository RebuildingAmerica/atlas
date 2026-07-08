// @vitest-environment jsdom
/* eslint-disable atlas-tests/no-test-file-locals */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscountVerificationSection } from "@/domains/billing/verification/discount-verification-section";

interface SubmittedDiscountRequestBody {
  data: Record<string, string>;
  segment: string;
  user_id: string;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
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

function mockFetch(response: Response): void {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(response));
}

function requestInitFor(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): RequestInit {
  const requestInit = fetchMock.mock.calls[0]?.[1];
  if (!requestInit) {
    throw new Error("Expected fetch to receive request init");
  }
  return requestInit;
}

function requestBodyFor(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): string {
  const requestBody = requestInitFor(fetchMock).body;
  if (typeof requestBody !== "string") {
    throw new Error("Expected fetch request body to be a JSON string");
  }
  return requestBody;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DiscountVerificationSection", () => {
  it("announces submitted verification requests as a status", async () => {
    mockFetch(jsonResponse({ ok: true }, 200));
    renderDiscountVerificationSection();

    fireEvent.click(screen.getByRole("button", { name: /Independent Creator or Journalist/i }));
    fireEvent.change(screen.getByLabelText("Portfolio or Byline URL"), {
      target: { value: "https://example.org/byline" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request Verification" }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Verification submitted");
    });
  });

  it("submits student discount requests through the stepper", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true }, 200));
    vi.stubGlobal("fetch", fetchMock);
    renderDiscountVerificationSection();

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Student/i }));
    fireEvent.change(screen.getByLabelText("School email"), {
      target: { value: "maya@university.edu" },
    });
    fireEvent.change(screen.getByLabelText("School or program"), {
      target: { value: "Howard University" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request Verification" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/access/verify-discount",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const body = JSON.parse(requestBodyFor(fetchMock)) as SubmittedDiscountRequestBody;
    expect(body).toEqual({
      data: {
        schoolEmail: "maya@university.edu",
        schoolName: "Howard University",
      },
      segment: "student",
      user_id: "user_123",
    });
  });

  it("announces failed verification requests as an alert", async () => {
    mockFetch(jsonResponse({ detail: "Verification failed" }, 400));
    renderDiscountVerificationSection();

    fireEvent.click(screen.getByRole("button", { name: /Independent Creator or Journalist/i }));
    fireEvent.change(screen.getByLabelText("Portfolio or Byline URL"), {
      target: { value: "https://example.org/byline" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request Verification" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Verification failed");
    });
  });
});
