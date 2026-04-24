/**
 * SSR route for person profile pages.
 *
 * Canonical URL: /profiles/people/:slug
 * Rendering: Server-side with full meta tags and JSON-LD structured data.
 */
import { createFileRoute } from "@tanstack/react-router";
import { PersonProfilePage } from "@/domains/catalog/pages/profiles/detail/person-profile-page";
import { loadProfileBySlug } from "@/domains/catalog/server/profiles/profile-loaders";

export const Route = createFileRoute("/_public/profiles/people/$slug")({
  loader: async ({ params }) => {
    const entry = await loadProfileBySlug({
      data: { type: "people", slug: params.slug },
    });
    return { entry };
  },
  head: ({ loaderData }) => {
    const entry = loaderData?.entry;
    if (!entry) return {};
    const canonicalUrl = `https://atlas.rebuildingamerica.com/profiles/people/${entry.slug}`;
    return {
      meta: [
        { title: `${entry.name} — Person | Atlas` },
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
  component: PersonProfileRoute,
});

function PersonProfileRoute() {
  const { entry } = Route.useLoaderData();
  return <PersonProfilePage entry={entry} />;
}
