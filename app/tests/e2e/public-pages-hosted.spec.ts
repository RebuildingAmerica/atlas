import { expect, test } from "@playwright/test";
import {
  absoluteHostedUrl,
  hostedPublicRequestInit,
  requiredHostedOrigin,
} from "../helpers/hosted-endpoints";
import { firstProfilePath, PUBLIC_PAGE_PATHS } from "../helpers/hosted-public-pages";

// The catalog smoke read API JSON and passed on 2026-09-14 while every
// server-rendered public page returned 500, so this loads the pages visitors
// actually open and fails on any server error or error panel.
const REQUEST_TIMEOUT_MS = 20_000;

test.describe("hosted public pages", () => {
  test("render without a server error or an error panel", async () => {
    test.setTimeout(120_000);
    const origin = requiredHostedOrigin("ATLAS_HOSTED_PUBLIC_URL");
    const paths = [
      ...PUBLIC_PAGE_PATHS,
      await test.step("find a person profile", () => firstProfilePath(origin, "person")),
      await test.step("find an organization profile", () =>
        firstProfilePath(origin, "organization")),
    ];

    for (const path of paths) {
      await test.step(path, async () => {
        const response = await fetch(
          absoluteHostedUrl(origin, path),
          hostedPublicRequestInit({ signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
        );
        const body = await response.text();

        expect(response.status, path).toBeLessThan(500);
        expect(body, path).not.toContain(`data-testid="route-error-panel"`);
        expect(body, path).not.toContain("Something went wrong");
      });
    }
  });

  // Visitor reports can carry contact details, so no anonymous caller may read
  // the editor inbox through either the app's proxy or the API directly.
  test("keep the private correction inbox away from anonymous callers", async () => {
    const appOrigin = requiredHostedOrigin("ATLAS_HOSTED_PUBLIC_URL");
    const apiOrigin = requiredHostedOrigin("ATLAS_HOSTED_API_URL");
    const timeout = { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
    // Vercel access credentials go only to the app, never to the API.
    const requests: [string, RequestInit][] = [
      [appOrigin, hostedPublicRequestInit(timeout)],
      [apiOrigin, timeout],
    ];
    for (const [origin, init] of requests) {
      await test.step(origin, async () => {
        const response = await fetch(absoluteHostedUrl(origin, "/api/correction-inbox"), init);
        expect(response.status, origin).toBe(401);
      });
    }
  });
});
