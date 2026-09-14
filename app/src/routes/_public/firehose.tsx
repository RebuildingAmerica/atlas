import { createFileRoute } from "@tanstack/react-router";
import {
  FirehoseFeedPage,
  FirehoseFeedPlaceholder,
} from "@rebuildingamerica/atlas-catalog/firehose/firehose-feed-page";
import {
  normalizePublicFirehoseSearch,
  publicFirehoseSearchSchema,
  type PublicFirehoseSnapshot,
} from "@rebuildingamerica/atlas-catalog/firehose/public-feed";
import { fetchPublicFirehoseSignals } from "@/platform/firehose/public-feed";
import { loadOrDegrade } from "@/platform/routes/load-or-degrade";
import { useDegradedRouteData } from "@/platform/routes/use-degraded-route-data";
import { buildCanonicalUrl, buildPageHead } from "@/platform/seo";

interface FirehoseSearch {
  issue?: string;
  limit?: number;
  place?: string;
  signal_type?: string;
  source_class?: string;
}

interface FirehoseLoaderDeps {
  search: FirehoseSearch;
}

interface FirehoseLoaderData {
  /** Absent when the API failed, so the page fetches it in the browser. */
  initialSnapshot: PublicFirehoseSnapshot | undefined;
}

interface DegradedFirehoseProps {
  search: FirehoseSearch;
}

export const Route = createFileRoute("/_public/firehose")({
  validateSearch: publicFirehoseSearchSchema,
  loaderDeps: ({ search }): FirehoseLoaderDeps => ({ search }),
  loader: async ({ deps }): Promise<FirehoseLoaderData> => ({
    initialSnapshot: await loadOrDegrade(() => fetchPublicFirehoseSignals(deps.search)),
  }),
  head: () => {
    const head = buildPageHead({
      description: "Latest source-backed public civic updates from Atlas.",
      noindex: true,
      path: "/firehose",
      title: "Firehose | Atlas",
    });
    return {
      ...head,
      links: [...head.links, { href: buildCanonicalUrl("/firehose.rss"), rel: "alternate" }],
    };
  },
  component: FirehoseRoute,
});

function DegradedFirehose({ search }: DegradedFirehoseProps) {
  const snapshot = useDegradedRouteData({
    queryFn: () => fetchPublicFirehoseSignals(search),
    queryKey: ["firehose", "public", search],
  });

  if (snapshot) {
    return <FirehoseFeedPage initialSnapshot={snapshot} />;
  }
  return <FirehoseFeedPlaceholder query={normalizePublicFirehoseSearch(search)} />;
}

function FirehoseRoute() {
  const { initialSnapshot } = Route.useLoaderData();
  const search = Route.useSearch();

  if (initialSnapshot) {
    return <FirehoseFeedPage initialSnapshot={initialSnapshot} />;
  }
  return <DegradedFirehose search={search} />;
}
