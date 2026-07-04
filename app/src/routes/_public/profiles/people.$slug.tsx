/**
 * SSR route for person profile pages.
 *
 * Canonical URL: /profiles/people/:slug
 * Rendering: Server-side with full meta tags and JSON-LD structured data.
 */
import { createFileRoute } from "@tanstack/react-router";
import { PersonProfilePage } from "@/domains/catalog/pages/profiles/detail/person-profile-page";
import { loadProfileBySlug } from "@/domains/catalog/server/profiles/profile-loaders";
import { buildPageHead } from "@/platform/seo";

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
    return buildPageHead({
      title: `${entry.name} — Person | Atlas`,
      socialTitle: entry.name,
      description: entry.description?.slice(0, 160) ?? "",
      path: `/profiles/people/${entry.slug}`,
      type: "profile",
    });
  },
  component: PersonProfileRoute,
});

function PersonProfileRoute() {
  const { entry } = Route.useLoaderData();
  return <PersonProfilePage entry={entry} />;
}
