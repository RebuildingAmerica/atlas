/**
 * SSR route for organization profile pages.
 *
 * Canonical URL: /profiles/organizations/:slug
 * Rendering: Server-side with full meta tags and JSON-LD structured data.
 */
import { createFileRoute } from "@tanstack/react-router";
import { ProfileRoutePage } from "@/domains/catalog/pages/profiles/detail/profile-route-page";
import { loadProfileBySlug } from "@/domains/catalog/server/profiles/profile-loaders";
import { loadOrDegrade } from "@/platform/routes/load-or-degrade";
import { buildPageHead } from "@/platform/seo";

export const Route = createFileRoute("/_public/profiles/organizations/$slug")({
  loader: async ({ params }) => {
    const entry = await loadOrDegrade(() =>
      loadProfileBySlug({ data: { type: "organizations", slug: params.slug } }),
    );
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
      imagePath: entry.photo_url?.trim() || undefined,
    });
  },
  component: OrgProfileRoute,
});

function OrgProfileRoute() {
  const { entry } = Route.useLoaderData();
  const { slug } = Route.useParams();
  return <ProfileRoutePage scope="organizations" slug={slug} entry={entry} />;
}
