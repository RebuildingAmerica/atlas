import "@tanstack/react-start/server-only";

import { createHash } from "node:crypto";

import { parseEnvBoolean } from "@/platform/config/env-boolean";

export interface AnonymousRateLimitConfig {
  enabled: boolean;
  readsPerMinute: number;
  writesPerMinute: number;
  totalPerHour: number;
  trustedProxyHops: number;
}

interface BucketSpec {
  limit: number;
  name: string;
  windowMs: number;
}

export interface RateLimitReservation {
  allowed: boolean;
  bucketName: string;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

export interface AnonymousRateLimitLogContext {
  clientKey: string;
  layer: "app-proxy";
  method: string;
  pathname: string;
}

const MAX_TRACKED_RATE_LIMIT_BUCKETS = 50_000;

export const DEFAULT_ANONYMOUS_RATE_LIMIT: AnonymousRateLimitConfig = {
  enabled: true,
  readsPerMinute: 30,
  totalPerHour: 120,
  trustedProxyHops: 1,
  writesPerMinute: 10,
};

function parseNonNegativeInteger(
  value: string | undefined,
  fallback: number,
  label: string,
): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
}

export function resolveAnonymousRateLimitConfig(env: NodeJS.ProcessEnv): AnonymousRateLimitConfig {
  return {
    enabled: parseEnvBoolean(
      env.ATLAS_ANON_RATE_LIMIT_ENABLED,
      DEFAULT_ANONYMOUS_RATE_LIMIT.enabled,
      "ATLAS_ANON_RATE_LIMIT_ENABLED",
    ),
    readsPerMinute: parseNonNegativeInteger(
      env.ATLAS_ANON_RATE_LIMIT_READS_PER_MINUTE,
      DEFAULT_ANONYMOUS_RATE_LIMIT.readsPerMinute,
      "ATLAS_ANON_RATE_LIMIT_READS_PER_MINUTE",
    ),
    totalPerHour: parseNonNegativeInteger(
      env.ATLAS_ANON_RATE_LIMIT_TOTAL_PER_HOUR,
      DEFAULT_ANONYMOUS_RATE_LIMIT.totalPerHour,
      "ATLAS_ANON_RATE_LIMIT_TOTAL_PER_HOUR",
    ),
    trustedProxyHops: parseNonNegativeInteger(
      env.ATLAS_TRUSTED_PROXY_HOPS,
      DEFAULT_ANONYMOUS_RATE_LIMIT.trustedProxyHops,
      "ATLAS_TRUSTED_PROXY_HOPS",
    ),
    writesPerMinute: parseNonNegativeInteger(
      env.ATLAS_ANON_RATE_LIMIT_WRITES_PER_MINUTE,
      DEFAULT_ANONYMOUS_RATE_LIMIT.writesPerMinute,
      "ATLAS_ANON_RATE_LIMIT_WRITES_PER_MINUTE",
    ),
  };
}

export class SlidingWindowRateLimiter {
  private readonly events = new Map<string, number[]>();
  private readonly bucketWindowMs = new Map<string, number>();
  private readonly maxTrackedBuckets: number;

  /**
   * @param maxTrackedBuckets - Ceiling on simultaneously tracked buckets before
   *   the least recently started buckets are evicted.
   */
  constructor(maxTrackedBuckets: number = MAX_TRACKED_RATE_LIMIT_BUCKETS) {
    this.maxTrackedBuckets = maxTrackedBuckets;
  }

  reserve(clientKey: string, bucketSpecs: readonly BucketSpec[]): RateLimitReservation {
    const now = Date.now();

    for (const spec of bucketSpecs) {
      this.bucketWindowMs.set(this.bucketKey(clientKey, spec.name), spec.windowMs);
    }
    this.pruneStaleBuckets(now);

    for (const spec of bucketSpecs) {
      const key = this.bucketKey(clientKey, spec.name);
      const timestamps = this.prunedTimestamps(key, now, spec.windowMs);
      if (timestamps.length >= spec.limit) {
        return {
          allowed: false,
          bucketName: spec.name,
          limit: spec.limit,
          remaining: 0,
          retryAfterSeconds: this.retryAfterSeconds(timestamps, now, spec.windowMs),
        };
      }
    }

    const remainingValues: number[] = [];
    const retryValues: number[] = [];
    for (const spec of bucketSpecs) {
      const key = this.bucketKey(clientKey, spec.name);
      const timestamps = this.prunedTimestamps(key, now, spec.windowMs);
      timestamps.push(now);
      this.events.set(key, timestamps);
      remainingValues.push(Math.max(spec.limit - timestamps.length, 0));
      retryValues.push(this.retryAfterSeconds(timestamps, now, spec.windowMs));
    }

    return {
      allowed: true,
      bucketName: "",
      limit: Math.min(...bucketSpecs.map((spec) => spec.limit)),
      remaining: Math.min(...remainingValues),
      retryAfterSeconds: Math.max(...retryValues),
    };
  }

  private bucketKey(clientKey: string, bucketName: string): string {
    return `${clientKey}:${bucketName}`;
  }

  private prunedTimestamps(key: string, now: number, windowMs: number): number[] {
    const cutoff = now - windowMs;
    return (this.events.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
  }

  private pruneStaleBuckets(now: number): void {
    // Iterating the window index rather than the event map keeps buckets that
    // were registered by a denied reservation (which never records an event)
    // from lingering for the lifetime of the process.
    for (const [key, windowMs] of [...this.bucketWindowMs]) {
      const pruned = this.prunedTimestamps(key, now, windowMs);
      if (pruned.length === 0) {
        this.events.delete(key);
        this.bucketWindowMs.delete(key);
      } else {
        this.events.set(key, pruned);
      }
    }

    const overflowCount = this.events.size - this.maxTrackedBuckets;
    if (overflowCount <= 0) {
      return;
    }

    const bucketsByAge = [...this.events].map(([key, timestamps]) => ({
      key,
      startedAt: Math.min(...timestamps),
    }));
    bucketsByAge.sort((left, right) => left.startedAt - right.startedAt);

    for (const { key } of bucketsByAge.slice(0, overflowCount)) {
      this.events.delete(key);
      this.bucketWindowMs.delete(key);
    }
  }

  private retryAfterSeconds(timestamps: readonly number[], now: number, windowMs: number): number {
    const [oldest] = timestamps;
    if (oldest === undefined) {
      return Math.ceil(windowMs / 1000);
    }
    return Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
  }
}

export function bucketSpecsForRequest(
  method: string,
  config: AnonymousRateLimitConfig,
): readonly BucketSpec[] {
  const isRead = method === "GET" || method === "HEAD";
  return [
    {
      limit: isRead ? config.readsPerMinute : config.writesPerMinute,
      name: isRead ? "read-minute" : "write-minute",
      windowMs: 60_000,
    },
    {
      limit: config.totalPerHour,
      name: "total-hour",
      windowMs: 3_600_000,
    },
  ];
}

export function buildTooManyRequestsResponse(result: RateLimitReservation): Response {
  const resetAt = Math.ceil(Date.now() / 1000 + result.retryAfterSeconds);
  return Response.json(
    { detail: "Too many requests." },
    {
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(resetAt),
      },
      status: 429,
    },
  );
}

export function logAnonymousRateLimit(
  result: RateLimitReservation,
  context: AnonymousRateLimitLogContext,
): void {
  console.warn("anonymous_rate_limited", {
    bucket: result.bucketName,
    client_key_hash: createHash("sha256").update(context.clientKey).digest("hex").slice(0, 16),
    event: "anonymous_rate_limited",
    layer: context.layer,
    method: context.method,
    path_group: pathGroup(context.pathname),
    retry_after_seconds: result.retryAfterSeconds,
  });
}

export function resolveClientIp(request: Request, trustedProxyHops: number): string | null {
  return (
    forwardedForClientIp(request.headers.get("x-forwarded-for"), trustedProxyHops) ??
    forwardedHeaderClientIp(request.headers.get("forwarded"))
  );
}

function forwardedForClientIp(headerValue: string | null, trustedProxyHops: number): string | null {
  if (!headerValue) {
    return null;
  }
  const addresses = headerValue
    .split(",")
    .map((part) => normalizedIp(part))
    .filter((address): address is string => address !== null);
  // With no trusted proxies in front of us, only the hop that appended the
  // rightmost entry is verifiable; everything to its left is caller-supplied
  // and therefore spoofable.
  const index =
    trustedProxyHops <= 0
      ? addresses.length - 1
      : Math.max(0, addresses.length - trustedProxyHops - 1);
  return addresses[index] ?? null;
}

function pathGroup(pathname: string): string {
  if (pathname.startsWith("/api/")) {
    return "/api/*";
  }
  if (pathname.startsWith("/mcp")) {
    return "/mcp/*";
  }
  return pathname;
}

function forwardedHeaderClientIp(headerValue: string | null): string | null {
  if (!headerValue) {
    return null;
  }
  // RFC 7239 §4: only the first list element is the original client; the rest
  // were appended by intermediaries closer to us.
  const forPair = headerValue
    .split(",")
    .slice(0, 1)
    .flatMap((entry) => entry.split(";"))
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith("for="));
  return normalizedIp(forPair?.slice(4));
}

function normalizedIp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const candidate = value.trim().replace(/^"|"$/g, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(candidate)) {
    return candidate;
  }
  const bracketedIpv6 = /^\[([0-9a-f:]+)\](?::\d+)?$/i.exec(candidate);
  if (bracketedIpv6?.[1]) {
    return bracketedIpv6[1].toLowerCase();
  }
  if (/^[0-9a-f:]+$/i.test(candidate) && candidate.includes(":")) {
    return candidate.toLowerCase();
  }
  return null;
}
