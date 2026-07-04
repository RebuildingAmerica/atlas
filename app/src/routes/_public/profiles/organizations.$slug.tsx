/**
 * SSR route for organization profile pages.
 *
 * Canonical URL: /profiles/organizations/:slug
 * Rendering: Server-side with full meta tags and JSON-LD structured data.
 */
import { createFileRoute } from "@tanstack/react-router";
import { OrgProfilePage } from "@/domains/catalog/pages/profiles/detail/org-profile-page";
import { loadProfileBySlug } from "@/domains/catalog/server/profiles/profile-loaders";
import { buildPageHead } from "@/platform/seo";

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
    return buildPageHead({
      title: `${entry.name} — Organization | Atlas`,
      socialTitle: entry.name,
      description: entry.description?.slice(0, 160) ?? "",
      path: `/profiles/organizations/${entry.slug}`,
      type: "profile",
    });
  },
  component: OrgProfileRoute,
});

function OrgProfileRoute() {
  const { entry } = Route.useLoaderData();
  return <OrgProfilePage entry={entry} />;
}
