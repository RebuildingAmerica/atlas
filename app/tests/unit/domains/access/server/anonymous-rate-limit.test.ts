import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ANONYMOUS_RATE_LIMIT,
  SlidingWindowRateLimiter,
  bucketSpecsForRequest,
  buildTooManyRequestsResponse,
  logAnonymousRateLimit,
  resolveAnonymousRateLimitConfig,
  resolveClientIp,
} from "@/domains/access/server/anonymous-rate-limit";

describe("resolveAnonymousRateLimitConfig", () => {
  it("falls back to the shipped defaults when nothing is configured", () => {
    expect(resolveAnonymousRateLimitConfig({})).toEqual(DEFAULT_ANONYMOUS_RATE_LIMIT);
  });

  it("treats blank values as unset rather than as zero", () => {
    expect(
      resolveAnonymousRateLimitConfig({
        ATLAS_ANON_RATE_LIMIT_ENABLED: "   ",
        ATLAS_ANON_RATE_LIMIT_READS_PER_MINUTE: "  ",
        ATLAS_TRUSTED_PROXY_HOPS: "",
      }),
    ).toEqual(DEFAULT_ANONYMOUS_RATE_LIMIT);
  });

  it("reads every documented knob from the environment", () => {
    expect(
      resolveAnonymousRateLimitConfig({
        ATLAS_ANON_RATE_LIMIT_ENABLED: "true",
        ATLAS_ANON_RATE_LIMIT_READS_PER_MINUTE: "5",
        ATLAS_ANON_RATE_LIMIT_TOTAL_PER_HOUR: "50",
        ATLAS_ANON_RATE_LIMIT_WRITES_PER_MINUTE: "0",
        ATLAS_TRUSTED_PROXY_HOPS: "2",
      }),
    ).toEqual({
      enabled: true,
      readsPerMinute: 5,
      totalPerHour: 50,
      trustedProxyHops: 2,
      writesPerMinute: 0,
    });
  });

  it("parses ATLAS_ANON_RATE_LIMIT_ENABLED the same way the API's pydantic settings do", () => {
    expect(
      resolveAnonymousRateLimitConfig({ ATLAS_ANON_RATE_LIMIT_ENABLED: " FALSE " }).enabled,
    ).toBe(false);
    expect(resolveAnonymousRateLimitConfig({ ATLAS_ANON_RATE_LIMIT_ENABLED: "0" }).enabled).toBe(
      false,
    );
    expect(() =>
      resolveAnonymousRateLimitConfig({ ATLAS_ANON_RATE_LIMIT_ENABLED: "disabled" }),
    ).toThrow("ATLAS_ANON_RATE_LIMIT_ENABLED must be a boolean value.");
  });

  it("refuses limits that are not non-negative integers", () => {
    expect(() =>
      resolveAnonymousRateLimitConfig({ ATLAS_ANON_RATE_LIMIT_READS_PER_MINUTE: "12.5" }),
    ).toThrow("ATLAS_ANON_RATE_LIMIT_READS_PER_MINUTE must be a non-negative integer.");
    expect(() => resolveAnonymousRateLimitConfig({ ATLAS_TRUSTED_PROXY_HOPS: "-1" })).toThrow(
      "ATLAS_TRUSTED_PROXY_HOPS must be a non-negative integer.",
    );
    expect(() =>
      resolveAnonymousRateLimitConfig({ ATLAS_ANON_RATE_LIMIT_TOTAL_PER_HOUR: "lots" }),
    ).toThrow("ATLAS_ANON_RATE_LIMIT_TOTAL_PER_HOUR must be a non-negative integer.");
  });
});

describe("bucketSpecsForRequest", () => {
  it("meters reads and writes against separate buckets", () => {
    const config = { ...DEFAULT_ANONYMOUS_RATE_LIMIT, readsPerMinute: 7, writesPerMinute: 3 };

    expect(bucketSpecsForRequest("GET", config)).toEqual([
      { limit: 7, name: "read-minute", windowMs: 60_000 },
      { limit: 120, name: "total-hour", windowMs: 3_600_000 },
    ]);
    expect(bucketSpecsForRequest("HEAD", config)[0]).toEqual({
      limit: 7,
      name: "read-minute",
      windowMs: 60_000,
    });
    expect(bucketSpecsForRequest("POST", config)[0]).toEqual({
      limit: 3,
      name: "write-minute",
      windowMs: 60_000,
    });
  });
});

describe("SlidingWindowRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts down the remaining allowance and then denies the offending bucket", () => {
    const limiter = new SlidingWindowRateLimiter();
    const specs = bucketSpecsForRequest("GET", {
      ...DEFAULT_ANONYMOUS_RATE_LIMIT,
      readsPerMinute: 2,
      totalPerHour: 10,
    });

    expect(limiter.reserve("198.51.100.7", specs)).toEqual({
      allowed: true,
      bucketName: "",
      limit: 2,
      remaining: 1,
      retryAfterSeconds: 3600,
    });
    expect(limiter.reserve("198.51.100.7", specs).remaining).toBe(0);
    expect(limiter.reserve("198.51.100.7", specs)).toEqual({
      allowed: false,
      bucketName: "read-minute",
      limit: 2,
      remaining: 0,
      retryAfterSeconds: 60,
    });
  });

  it("keeps each client key in its own bucket", () => {
    const limiter = new SlidingWindowRateLimiter();
    const specs = bucketSpecsForRequest("POST", {
      ...DEFAULT_ANONYMOUS_RATE_LIMIT,
      writesPerMinute: 1,
    });

    expect(limiter.reserve("198.51.100.7", specs).allowed).toBe(true);
    expect(limiter.reserve("198.51.100.7", specs).allowed).toBe(false);
    expect(limiter.reserve("203.0.113.9", specs).allowed).toBe(true);
  });

  it("restores the allowance once the window has slid past the recorded events", () => {
    const limiter = new SlidingWindowRateLimiter();
    const specs = bucketSpecsForRequest("GET", {
      ...DEFAULT_ANONYMOUS_RATE_LIMIT,
      readsPerMinute: 1,
    });

    expect(limiter.reserve("198.51.100.7", specs).allowed).toBe(true);

    vi.advanceTimersByTime(30_000);
    const denied = limiter.reserve("198.51.100.7", specs);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBe(30);

    vi.advanceTimersByTime(31_000);
    expect(limiter.reserve("198.51.100.7", specs).allowed).toBe(true);
  });

  it("reports the hourly window when the hourly bucket is the one that trips", () => {
    const limiter = new SlidingWindowRateLimiter();
    const specs = bucketSpecsForRequest("GET", {
      ...DEFAULT_ANONYMOUS_RATE_LIMIT,
      readsPerMinute: 100,
      totalPerHour: 1,
    });

    expect(limiter.reserve("198.51.100.7", specs).allowed).toBe(true);
    expect(limiter.reserve("198.51.100.7", specs)).toEqual({
      allowed: false,
      bucketName: "total-hour",
      limit: 1,
      remaining: 0,
      retryAfterSeconds: 3600,
    });
  });

  it("denies immediately, for the whole window, when a bucket limit is zero", () => {
    const limiter = new SlidingWindowRateLimiter();
    const specs = bucketSpecsForRequest("POST", {
      ...DEFAULT_ANONYMOUS_RATE_LIMIT,
      writesPerMinute: 0,
    });

    expect(limiter.reserve("198.51.100.7", specs)).toEqual({
      allowed: false,
      bucketName: "write-minute",
      limit: 0,
      remaining: 0,
      retryAfterSeconds: 60,
    });
  });

  it("evicts the longest-running buckets once the tracking ceiling is passed", () => {
    const limiter = new SlidingWindowRateLimiter(2);
    const specs = [{ limit: 1, name: "read-minute", windowMs: 60_000 }];

    expect(limiter.reserve("first", specs).allowed).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(limiter.reserve("second", specs).allowed).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(limiter.reserve("third", specs).allowed).toBe(true);

    // "first" was evicted to make room, so its next request is admitted while
    // the two newer keys stay throttled.
    expect(limiter.reserve("first", specs).allowed).toBe(true);
    expect(limiter.reserve("third", specs).allowed).toBe(false);
  });
});

describe("buildTooManyRequestsResponse", () => {
  it("advertises the limit, the remainder, and when the caller may retry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T12:00:00.000Z"));

    const response = buildTooManyRequestsResponse({
      allowed: false,
      bucketName: "read-minute",
      limit: 30,
      remaining: 0,
      retryAfterSeconds: 42,
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-RateLimit-Limit")).toBe("30");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(response.headers.get("X-RateLimit-Reset")).toBe(
      String(Math.ceil(Date.parse("2026-07-26T12:00:00.000Z") / 1000) + 42),
    );
    await expect(response.json()).resolves.toEqual({ detail: "Too many requests." });

    vi.useRealTimers();
  });
});

describe("logAnonymousRateLimit", () => {
  it("groups the path and hashes the client key instead of logging the raw IP", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    logAnonymousRateLimit(
      {
        allowed: false,
        bucketName: "read-minute",
        limit: 30,
        remaining: 0,
        retryAfterSeconds: 12,
      },
      {
        clientKey: "198.51.100.7",
        layer: "app-proxy",
        method: "GET",
        pathname: "/api/entries/abc",
      },
    );

    expect(warn).toHaveBeenCalledWith("anonymous_rate_limited", {
      bucket: "read-minute",
      client_key_hash: expect.stringMatching(/^[0-9a-f]{16}$/) as string,
      event: "anonymous_rate_limited",
      layer: "app-proxy",
      method: "GET",
      path_group: "/api/*",
      retry_after_seconds: 12,
    });
    const [, payload] = (warn.mock.calls[0] ?? []) as readonly unknown[];
    expect(payload).not.toMatchObject({ client_key_hash: "198.51.100.7" });
  });

  it("collapses MCP paths and passes anything else through verbatim", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = {
      allowed: false,
      bucketName: "total-hour",
      limit: 120,
      remaining: 0,
      retryAfterSeconds: 60,
    };

    logAnonymousRateLimit(result, {
      clientKey: "unknown",
      layer: "app-proxy",
      method: "POST",
      pathname: "/mcp/messages",
    });
    logAnonymousRateLimit(result, {
      clientKey: "unknown",
      layer: "app-proxy",
      method: "POST",
      pathname: "/profiles/people/ada",
    });

    expect(warn.mock.calls.map((call) => (call[1] as { path_group: string }).path_group)).toEqual([
      "/mcp/*",
      "/profiles/people/ada",
    ]);
  });
});

describe("resolveClientIp", () => {
  it("skips the hops we operate and returns the address they attest to", () => {
    const request = new Request("https://atlas.test/api/entries", {
      headers: { "x-forwarded-for": "203.0.113.5, 198.51.100.7, 10.0.0.1" },
    });

    expect(resolveClientIp(request, 1)).toBe("198.51.100.7");
    expect(resolveClientIp(request, 2)).toBe("203.0.113.5");
  });

  it("trusts only the rightmost hop when no proxies sit in front of the app", () => {
    const request = new Request("https://atlas.test/api/entries", {
      headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.5, 198.51.100.7" },
    });

    expect(resolveClientIp(request, 0)).toBe("198.51.100.7");
  });

  it("clamps to the leftmost entry when the chain is shorter than the trusted hop count", () => {
    const request = new Request("https://atlas.test/api/entries", {
      headers: { "x-forwarded-for": "203.0.113.5" },
    });

    expect(resolveClientIp(request, 4)).toBe("203.0.113.5");
  });

  it("does not let a spoofed forwarded-for entry pose as an address", () => {
    const request = new Request("https://atlas.test/api/entries", {
      headers: { "x-forwarded-for": "not-an-ip, <script>, 999" },
    });

    expect(resolveClientIp(request, 1)).toBeNull();
  });

  it("ignores unparseable hops when picking the trusted position", () => {
    const request = new Request("https://atlas.test/api/entries", {
      headers: { "x-forwarded-for": "bogus, 203.0.113.5, 198.51.100.7" },
    });

    expect(resolveClientIp(request, 1)).toBe("203.0.113.5");
  });

  it("normalizes IPv6 hops with and without brackets or ports", () => {
    expect(
      resolveClientIp(
        new Request("https://atlas.test/api/entries", {
          headers: { "x-forwarded-for": "2001:DB8::1" },
        }),
        0,
      ),
    ).toBe("2001:db8::1");
    expect(
      resolveClientIp(
        new Request("https://atlas.test/api/entries", {
          headers: { "x-forwarded-for": "[2001:DB8::2]:41234" },
        }),
        0,
      ),
    ).toBe("2001:db8::2");
    expect(
      resolveClientIp(
        new Request("https://atlas.test/api/entries", {
          headers: { "x-forwarded-for": "[2001:db8::3]" },
        }),
        0,
      ),
    ).toBe("2001:db8::3");
  });

  it("rejects hex-only tokens that are not addresses at all", () => {
    const request = new Request("https://atlas.test/api/entries", {
      headers: { "x-forwarded-for": "deadbeef" },
    });

    expect(resolveClientIp(request, 0)).toBeNull();
  });

  it("falls back to the RFC 7239 Forwarded header", () => {
    const request = new Request("https://atlas.test/api/entries", {
      headers: { forwarded: "by=203.0.113.43;for=198.51.100.17;proto=http;host=atlas.test" },
    });

    expect(resolveClientIp(request, 1)).toBe("198.51.100.17");
  });

  it("uses only the first element of a Forwarded list", () => {
    const request = new Request("https://atlas.test/api/entries", {
      headers: { forwarded: 'for="[2001:db8::9]:4711", for=203.0.113.60' },
    });

    expect(resolveClientIp(request, 1)).toBe("2001:db8::9");
  });

  it("returns null when the Forwarded element carries no for= pair", () => {
    const request = new Request("https://atlas.test/api/entries", {
      headers: { forwarded: "proto=https;host=atlas.test" },
    });

    expect(resolveClientIp(request, 1)).toBeNull();
  });

  it("returns null when neither forwarding header is present", () => {
    expect(resolveClientIp(new Request("https://atlas.test/api/entries"), 1)).toBeNull();
  });

  it("returns null for an empty Forwarded value", () => {
    const request = new Request("https://atlas.test/api/entries", {
      headers: { forwarded: "" },
    });

    expect(resolveClientIp(request, 1)).toBeNull();
  });
});
