import { expect, test } from "@playwright/test";
import { absoluteHostedUrl, requiredHostedOrigin } from "../helpers/hosted-endpoints";

const shouldExerciseHostedRateLimit = process.env.ATLAS_HOSTED_EXPECT_RATE_LIMIT === "true";
const shouldExpectHostedEdge = process.env.ATLAS_HOSTED_EXPECT_EDGE === "true";

test.describe("hosted anonymous rate limits", () => {
  test.skip(
    !shouldExerciseHostedRateLimit,
    "Set ATLAS_HOSTED_EXPECT_RATE_LIMIT=true to intentionally exercise hosted rate limits.",
  );

  test("blocks repeated anonymous public reads", async () => {
    const apiOrigin = requiredHostedOrigin("ATLAS_HOSTED_API_URL");
    const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let blockedResponse: Response | null = null;

    for (let attempt = 0; attempt < 36; attempt += 1) {
      const response = await fetch(
        absoluteHostedUrl(
          apiOrigin,
          `/api/issue-areas?limit=1&rate_limit_smoke=${runId}-${attempt}`,
        ),
        {
          headers: {
            Accept: "application/json",
            "Cache-Control": "no-cache",
          },
        },
      );

      if (response.status === 429) {
        blockedResponse = response;
        break;
      }

      expect(response.status, `attempt ${attempt}`).toBeLessThan(500);
      expect(response.status, `attempt ${attempt}`).not.toBe(401);
      await response.arrayBuffer();
    }

    if (!blockedResponse) {
      throw new Error("Expected hosted anonymous reads to reach HTTP 429.");
    }

    const body = await blockedResponse.text();
    const retryAfter = blockedResponse.headers.get("retry-after");
    const resetAt = blockedResponse.headers.get("x-ratelimit-reset");

    expect(blockedResponse.status).toBe(429);
    expect(body).toContain("Too many requests");
    if (retryAfter) {
      expect(Number(retryAfter)).toBeGreaterThan(0);
    }
    if (resetAt) {
      expect(Number(resetAt)).toBeGreaterThan(1_000_000_000);
    }
  });
});

test.describe("hosted API edge", () => {
  test.skip(
    !shouldExpectHostedEdge,
    "Set ATLAS_HOSTED_EXPECT_EDGE=true to require Cloudflare edge response headers.",
  );

  test("serves the canonical API health check through Cloudflare", async () => {
    const apiOrigin = requiredHostedOrigin("ATLAS_HOSTED_API_URL");
    expect(new URL(apiOrigin).hostname.endsWith(".run.app")).toBe(false);

    const response = await fetch(absoluteHostedUrl(apiOrigin, "/health"), {
      redirect: "manual",
    });
    const cfRay = response.headers.get("cf-ray");
    const server = response.headers.get("server");

    expect(response.status).toBe(200);
    expect(Boolean(cfRay) || server?.toLowerCase() === "cloudflare").toBe(true);
  });
});
