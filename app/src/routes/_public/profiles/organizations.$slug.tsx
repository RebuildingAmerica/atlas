/**
 * SSR route for organization profile pages.
 *
 * Canonical URL: /profiles/organizations/:slug
 * Rendering: Server-side with full meta tags and JSON-LD structured data.
 */
import { createFileRoute } from "@tanstack/react-router";
import { loadProfileBySlug } from "@/domains/catalog/server/profile-loaders";
import { OrgProfilePage } from "@/domains/catalog/pages/org-profile-page";

export const Route = createFileRoute("/_public/profiles/organizations/$slug")({
  loader: async ({ params }) => {
    const entry = await loadProfileBySlug({
      data: { type: "organizations", slug: params.slug },
    });
    return { entry };
  },
  head: ({ loaderData }) => {
    const entry = loaderData?.entry;
    if (!entry) return {};
    const canonicalUrl = `https://atlas.rebuildingamerica.com/profiles/organizations/${entry.slug}`;
    return {
      meta: [
        { title: `${entry.name} — Organization | Atlas` },
        { name: "description", content: entry.description?.slice(0, 160) ?? "" },
        { property: "og:title", content: entry.name },
        { property: "og:description", content: entry.description ?? "" },
        { property: "og:type", content: "profile" },
        { property: "og:url", content: canonicalUrl },
        { property: "og:site_name", content: "Atlas" },
        { name: "twitter:card", content: "summary" },
        { name: "twitter:title", content: entry.name },
        { name: "twitter:description", content: entry.description?.slice(0, 160) ?? "" },
      ],
      links: [{ rel: "canonical", href: canonicalUrl }],
    };
  },
  component: OrgProfileRoute,
});

function OrgProfileRoute() {
  const { entry } = Route.useLoaderData();
  return <OrgProfilePage entry={entry} />;
}
