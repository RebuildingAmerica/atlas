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
test.describe("hosted public pages", () => {
  test("render without a server error or an error panel", async () => {
    const origin = requiredHostedOrigin("ATLAS_HOSTED_PUBLIC_URL");
    const paths = [
      ...PUBLIC_PAGE_PATHS,
      await firstProfilePath(origin, "person"),
      await firstProfilePath(origin, "organization"),
    ];

    for (const path of paths) {
      const response = await fetch(absoluteHostedUrl(origin, path), hostedPublicRequestInit());
      const body = await response.text();

      expect(response.status, path).toBeLessThan(500);
      expect(body, path).not.toContain(`data-testid="route-error-panel"`);
      expect(body, path).not.toContain("Something went wrong");
    }
  });
});
