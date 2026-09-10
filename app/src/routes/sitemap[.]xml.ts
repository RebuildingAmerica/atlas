/**
 * Sitemap XML endpoint for search engine indexing.
 *
 * Lists all person and organization profiles with canonical URLs and
 * lastmod dates. Served with XML content type so crawlers can consume
 * it directly.
 */
import { createFileRoute } from "@tanstack/react-router";
import type { Entry, EntryType } from "@rebuildingamerica/atlas-api-client";
import { api } from "@rebuildingamerica/atlas-api-client";
import { buildCanonicalUrl } from "@/platform/seo";

const ONE_HOUR = 3600;
const SITEMAP_PAGE_SIZE = 100;

type SitemapEntryType = Extract<EntryType, "person" | "organization">;

function fetchSitemapPage(entryType: SitemapEntryType, offset: number) {
  return api.entries.list({
    entry_types: [entryType],
    limit: SITEMAP_PAGE_SIZE,
    offset,
  });
}

// The API caps a page at 100 rows, so a growing catalog means more pages. The
// production canary timed out walking them one after another against a cold
// Cloud Run instance, so the first page's total drives the rest in parallel.
async function listSitemapEntries(entryType: SitemapEntryType): Promise<Entry[]> {
  const firstPage = await fetchSitemapPage(entryType, 0);
  const pageCount = Math.ceil(firstPage.pagination.total / SITEMAP_PAGE_SIZE);
  const laterPages = await Promise.all(
    Array.from({ length: Math.max(pageCount - 1, 0) }, (_unused, index) =>
      fetchSitemapPage(entryType, (index + 1) * SITEMAP_PAGE_SIZE),
    ),
  );

  return [firstPage, ...laterPages].flatMap((page) => page.data);
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const [people, orgs, publicDirectories] = await Promise.all([
          listSitemapEntries("person"),
          listSitemapEntries("organization"),
          api.publicDirectories.list(),
        ]);

        const entries = [...people, ...orgs];

        const profileUrls = entries
          .filter((entry) => entry.slug)
          .map((entry) => {
            const typePrefix = entry.type === "person" ? "people" : "organizations";
            return `  <url>
    <loc>${buildCanonicalUrl(`/profiles/${typePrefix}/${entry.slug}`)}</loc>
    <lastmod>${entry.updated_at.split("T")[0]}</lastmod>
    <changefreq>weekly</changefreq>
  </url>`;
          });

        const directoryUrls = publicDirectories.directories.map((directory) => {
          const lastmod = directory.last_published_at
            ? `\n    <lastmod>${directory.last_published_at.split("T")[0]}</lastmod>`
            : "";
          return `  <url>
    <loc>${buildCanonicalUrl(`/directories/${directory.org_id}`)}</loc>${lastmod}
    <changefreq>daily</changefreq>
  </url>`;
        });

        const urls = [...profileUrls, ...directoryUrls];

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${buildCanonicalUrl("")}</loc>
    <changefreq>daily</changefreq>
  </url>
  <url>
    <loc>${buildCanonicalUrl("/browse")}</loc>
    <changefreq>daily</changefreq>
  </url>
${urls.join("\n")}
</urlset>`;

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": `public, max-age=${ONE_HOUR}, s-maxage=${ONE_HOUR}`,
          },
        });
      },
    },
  },
});
