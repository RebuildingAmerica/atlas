import { EntryDetail } from "@/domains/catalog/components/entries/entry-detail";
import { buildPageHead } from "@/platform/seo";
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

    return buildPageHead({
      title: `${entry.name} — ${config.singularLabel} | Atlas`,
      socialTitle: entry.name,
      description: entry.description?.slice(0, 160) ?? "",
      path: `${config.canonicalPath}/${entry.slug}`,
      type: "article",
    });
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
