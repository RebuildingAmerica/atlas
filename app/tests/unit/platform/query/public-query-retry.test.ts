import { notFound } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import {
  PUBLIC_QUERY_RETRY_CAP_MS,
  PUBLIC_QUERY_RETRY_OPTIONS,
  publicQueryRetryDelay,
  shouldRetryPublicQuery,
} from "@/platform/query/public-query-retry";

describe("public query retry", () => {
  it("keeps retrying an outage no matter how many attempts have failed", () => {
    const rateLimited = Object.assign(new Error("Too many requests."), { status: 429 });

    expect(shouldRetryPublicQuery(0, rateLimited)).toBe(true);
    expect(shouldRetryPublicQuery(500, new TypeError("fetch failed"))).toBe(true);
  });

  it("stops at a missing record so the page can render not-found", () => {
    expect(shouldRetryPublicQuery(0, notFound())).toBe(false);
  });

  it("backs off exponentially and caps the wait", () => {
    expect(publicQueryRetryDelay(0)).toBe(1_000);
    expect(publicQueryRetryDelay(1)).toBe(2_000);
    expect(publicQueryRetryDelay(4)).toBe(16_000);
    expect(publicQueryRetryDelay(5)).toBe(PUBLIC_QUERY_RETRY_CAP_MS);
    expect(publicQueryRetryDelay(40)).toBe(PUBLIC_QUERY_RETRY_CAP_MS);
  });

  it("bundles the policy with a refetch when the browser reconnects", () => {
    expect(PUBLIC_QUERY_RETRY_OPTIONS).toEqual({
      refetchOnReconnect: true,
      retry: shouldRetryPublicQuery,
      retryDelay: publicQueryRetryDelay,
    });
  });
});
