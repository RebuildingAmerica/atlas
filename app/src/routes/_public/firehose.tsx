import { createFileRoute } from "@tanstack/react-router";
import { FirehoseFeedPage } from "@rebuildingamerica/atlas-catalog/firehose/firehose-feed-page";
import {
  publicFirehoseSearchSchema,
  type PublicFirehoseSnapshot,
} from "@rebuildingamerica/atlas-catalog/firehose/public-feed";
import { fetchPublicFirehoseSignals } from "@/platform/firehose/public-feed";
import { buildCanonicalUrl, buildPageHead } from "@/platform/seo";

interface FirehoseLoaderDeps {
  search: {
    issue?: string;
    limit?: number;
    place?: string;
    signal_type?: string;
    source_class?: string;
  };
}

interface FirehoseLoaderData {
  initialSnapshot: PublicFirehoseSnapshot;
}

export const Route = createFileRoute("/_public/firehose")({
  validateSearch: publicFirehoseSearchSchema,
  loaderDeps: ({ search }): FirehoseLoaderDeps => ({ search }),
  loader: async ({ deps }): Promise<FirehoseLoaderData> => {
    return {
      initialSnapshot: await fetchPublicFirehoseSignals(deps.search),
    };
  },
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

function FirehoseRoute() {
  const { initialSnapshot } = Route.useLoaderData();
  return <FirehoseFeedPage initialSnapshot={initialSnapshot} />;
}
