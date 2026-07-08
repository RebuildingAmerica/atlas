import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
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

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 lg:py-12">
      <Link
        to={
          `/profiles/${entry.type === "organization" ? "organizations" : "people"}/${entry.slug}` as "/profiles"
        }
        className="type-label-medium text-ink-soft hover:text-ink-strong inline-flex items-center gap-2 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to profile
      </Link>

      <ClaimPage slug={slug} entry={entry} search={search} />
    </div>
  );
}
