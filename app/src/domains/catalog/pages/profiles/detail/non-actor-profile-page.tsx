import { EntryDetail } from "@/domains/catalog/components/entries/entry-detail";
import { buildCanonicalUrl } from "@/platform/seo";
import type { Entry, EntrySlugScope } from "@/types";

interface NonActorProfilePageProps {
  entry: Entry;
}

interface NonActorRouteConfig {
  scope: EntrySlugScope;
  singularLabel: string;
  canonicalPath: string;
}

interface NonActorHeadInput {
  loaderData?: {
    entry?: Entry;
  };
}

export const NON_ACTOR_PROFILE_ROUTES = {
  initiatives: {
    scope: "initiatives",
    singularLabel: "Initiative",
    canonicalPath: "/profiles/initiatives",
  },
  campaigns: {
    scope: "campaigns",
    singularLabel: "Campaign",
    canonicalPath: "/profiles/campaigns",
  },
  events: {
    scope: "events",
    singularLabel: "Event",
    canonicalPath: "/profiles/events",
  },
} as const satisfies Record<string, NonActorRouteConfig>;

export function buildNonActorProfileHead(config: NonActorRouteConfig) {
  return ({ loaderData }: NonActorHeadInput) => {
    const entry = loaderData?.entry;
    if (!entry) return {};
    const canonicalUrl = buildCanonicalUrl(`${config.canonicalPath}/${entry.slug}`);

    return {
      meta: [
        { title: `${entry.name} — ${config.singularLabel} | Atlas` },
        { name: "description", content: entry.description?.slice(0, 160) ?? "" },
        { property: "og:title", content: entry.name },
        { property: "og:description", content: entry.description ?? "" },
        { property: "og:type", content: "article" },
        { property: "og:url", content: canonicalUrl },
        { property: "og:site_name", content: "Atlas" },
        { name: "twitter:card", content: "summary" },
        { name: "twitter:title", content: entry.name },
        { name: "twitter:description", content: entry.description?.slice(0, 160) ?? "" },
      ],
      links: [{ rel: "canonical", href: canonicalUrl }],
    };
  };
}

export function NonActorProfilePage({ entry }: NonActorProfilePageProps) {
  return (
    <main className="bg-page-bg px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <EntryDetail entry={entry} />
      </div>
    </main>
  );
}
