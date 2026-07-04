import { createFileRoute } from "@tanstack/react-router";
import { buildCanonicalUrl } from "@/platform/seo";

const ONE_HOUR = 3600;

function buildLlmsTxt(): string {
  return `# Atlas

Atlas provides source-linked public profiles for civic people, organizations, and initiatives across America.

## Public entry points

- Home: ${buildCanonicalUrl("")}
- Browse source-linked public profiles: ${buildCanonicalUrl("/browse")}
- Map civic actors by place: ${buildCanonicalUrl("/map")}
- XML sitemap: ${buildCanonicalUrl("/sitemap.xml")}
- OpenAPI schema: ${buildCanonicalUrl("/openapi.json")}

## Citation guidance

Use the public profile or directory URL as the canonical record URL. Prefer claims backed by visible sources on each profile, and cite the original public source when a profile links to it.
`;
}

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(buildLlmsTxt(), {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": `public, max-age=${ONE_HOUR}, s-maxage=${ONE_HOUR}`,
          },
        }),
    },
  },
});
