import { test as base } from "@playwright/test";
import { hostedPublicRequestInit } from "./hosted-endpoints";

interface PausedRequest {
  requestId: string;
  request: { url: string; headers: Record<string, string> };
}

// CDP intercepts every redirect hop. Playwright route.continue carries header
// overrides across redirects, and context routes intercept only the first hop.
export const test = base.extend({
  page: async ({ context, baseURL, browserName }, provide) => {
    if (!baseURL || browserName !== "chromium")
      throw new Error("Hosted protected tests require a baseURL and Chromium.");
    const origin = new URL(baseURL).origin;
    const trusted = new Headers(hostedPublicRequestInit().headers);
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    let interceptFailure: Error | undefined;
    const intercept = async (event: PausedRequest) => {
      const blocked = [
        "cf-access-client-id",
        "cf-access-client-secret",
        "x-vercel-protection-bypass",
        "x-vercel-trusted-oidc-idp-token",
      ];
      const headers = Object.fromEntries(
        Object.entries(event.request.headers).filter(
          ([key]) => !blocked.includes(key.toLowerCase()),
        ),
      );
      if (new URL(event.request.url).origin === origin)
        trusted.forEach((value, key) => {
          headers[key] = value;
        });
      await session.send("Fetch.continueRequest", {
        requestId: event.requestId,
        headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
      });
    };
    session.on("Fetch.requestPaused", (event: PausedRequest) => {
      void intercept(event).catch((error: unknown) => {
        interceptFailure =
          error instanceof Error ? error : new Error("Hosted request interception failed.");
        void page.close();
      });
    });
    await session.send("Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: "Request" }],
    });
    try {
      await provide(page);
    } finally {
      await session.detach();
      await page.close();
    }
    if (interceptFailure) throw interceptFailure;
  },
});
