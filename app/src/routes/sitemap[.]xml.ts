/**
 * Sitemap XML endpoint for search engine indexing.
 *
 * Lists all person and organization profiles with canonical URLs and
 * lastmod dates. Served with XML content type so crawlers can consume
 * it directly.
 */
import { createFileRoute } from "@tanstack/react-router";
import { api } from "@/lib/api";

const ATLAS_BASE_URL = "https://atlas.rebuildingamerica.com";
const ONE_HOUR = 3600;

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const [people, orgs, publicDirectories] = await Promise.all([
          api.entries.list({ entry_types: ["person"], limit: 10000 }),
          api.entries.list({ entry_types: ["organization"], limit: 10000 }),
          api.publicDirectories.list(),
        ]);

        const entries = [...(people.data ?? []), ...(orgs.data ?? [])];

        const profileUrls = entries
          .filter((entry) => entry.slug)
          .map((entry) => {
            const typePrefix = entry.type === "person" ? "people" : "organizations";
            return `  <url>
    <loc>${ATLAS_BASE_URL}/profiles/${typePrefix}/${entry.slug}</loc>
    <lastmod>${entry.updated_at.split("T")[0]}</lastmod>
    <changefreq>weekly</changefreq>
  </url>`;
          });

        const directoryUrls = publicDirectories.directories.map((directory) => {
          const lastmod = directory.last_published_at
            ? `\n    <lastmod>${directory.last_published_at.split("T")[0]}</lastmod>`
            : "";
          return `  <url>
    <loc>${ATLAS_BASE_URL}/directories/${directory.org_id}</loc>${lastmod}
    <changefreq>daily</changefreq>
  </url>`;
        });

        const urls = [...profileUrls, ...directoryUrls];

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${ATLAS_BASE_URL}</loc>
    <changefreq>daily</changefreq>
  </url>
  <url>
    <loc>${ATLAS_BASE_URL}/browse</loc>
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
