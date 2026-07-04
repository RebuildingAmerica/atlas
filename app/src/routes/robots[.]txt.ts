import { createFileRoute } from "@tanstack/react-router";
import { buildCanonicalUrl } from "@/platform/seo";

const ONE_HOUR = 3600;
const DISALLOWED_PATHS = [
  "/api/",
  "/account",
  "/account-setup",
  "/admin.discounts",
  "/briefs",
  "/checkout-complete",
  "/coverage",
  "/dashboard",
  "/device",
  "/discovery",
  "/feed",
  "/lists",
  "/manage",
  "/organization",
  "/sign-in",
  "/sign-up",
  "/watching",
];

function buildRobotsTxt(): string {
  const disallowRules = DISALLOWED_PATHS.map((path) => `Disallow: ${path}`).join("\n");

  return `User-agent: *
Allow: /
${disallowRules}

Sitemap: ${buildCanonicalUrl("/sitemap.xml")}
`;
}

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(buildRobotsTxt(), {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": `public, max-age=${ONE_HOUR}, s-maxage=${ONE_HOUR}`,
          },
        }),
    },
  },
});
