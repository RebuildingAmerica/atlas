/**
 * Legacy entry detail route — redirects to canonical profile URLs.
 *
 * /entries/:id → 301 → /profiles/people/:slug or /profiles/organizations/:slug
 *
 * Non-actor entry types (initiative, campaign, event) redirect to /browse
 * until dedicated detail views are built for those types.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";
import { api } from "@/lib/api";

export const Route = createFileRoute("/_public/entries/$entryId")({
  loader: async ({ params }) => {
    const entry = await api.entries.get(params.entryId);

    if (entry.type === "person" && entry.slug) {
      throw redirect({
        to: "/profiles/people/$slug",
        params: { slug: entry.slug },
        statusCode: 301,
      });
    }

    if (entry.type === "organization" && entry.slug) {
      throw redirect({
        to: "/profiles/organizations/$slug",
        params: { slug: entry.slug },
        statusCode: 301,
      });
    }

    throw redirect({ to: "/browse", statusCode: 302 });
  },
  component: () => null,
});
