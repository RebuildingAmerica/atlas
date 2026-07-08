import { createFileRoute } from "@tanstack/react-router";
import { ClaimPage } from "./claim-page";
import { loadEntryBySlugAny } from "@/domains/catalog/server/profiles/profile-loaders";
import { buildPageHead } from "@/platform/seo";
import { z } from "zod";

const claimSearchSchema = z.object({
  from: z.string().optional(),
  token: z.string().optional(),
});

export const Route = createFileRoute("/_public/claim/$slug")({
  validateSearch: claimSearchSchema,
  loader: async ({ params }) => {
    const entry = await loadEntryBySlugAny({ data: { slug: params.slug } });
    return { entry };
  },
  head: ({ loaderData }) => {
    const entry = loaderData?.entry;
    if (!entry) return {};
    return buildPageHead({
      title: `Claim ${entry.name} | Atlas`,
      description: `Verify and manage the Atlas profile for ${entry.name}.`,
      path: `/claim/${entry.slug}`,
      noindex: true,
    });
  },
  component: ClaimRoute,
});

function ClaimRoute() {
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  const { entry } = Route.useLoaderData();

  return <ClaimPage slug={slug} entry={entry} search={search} />;
}
