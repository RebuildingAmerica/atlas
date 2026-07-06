import { createFileRoute } from "@tanstack/react-router";
import {
  listPublicFirehoseSignals,
  type PublicFirehoseSearchInput,
} from "@/domains/firehose/public-feed";
import { buildFirehoseRss } from "@/domains/firehose/rss";

const RSS_CACHE_SECONDS = 60;

interface FirehoseRssHandlerInput {
  request: Request;
}

function searchInputFromUrl(url: URL): PublicFirehoseSearchInput {
  const input: PublicFirehoseSearchInput = {};
  const issue = url.searchParams.getAll("issue");
  const place = url.searchParams.getAll("place");
  const signalType = url.searchParams.getAll("signal_type");
  const sourceClass = url.searchParams.getAll("source_class");
  const limit = url.searchParams.get("limit");
  if (issue.length > 0) input.issue = issue;
  if (place.length > 0) input.place = place.length === 1 ? place[0] : place;
  if (signalType.length > 0) input.signal_type = signalType;
  if (sourceClass.length > 0) input.source_class = sourceClass;
  if (limit) input.limit = limit;
  return input;
}

export const Route = createFileRoute("/firehose.rss")({
  server: {
    handlers: {
      GET: ({ request }: FirehoseRssHandlerInput) => {
        const requestUrl = new URL(request.url);
        const snapshot = listPublicFirehoseSignals(searchInputFromUrl(requestUrl));
        const body = buildFirehoseRss(snapshot, requestUrl.toString());
        return new Response(body, {
          headers: {
            "Cache-Control": `public, max-age=${RSS_CACHE_SECONDS}, s-maxage=${RSS_CACHE_SECONDS}`,
            "Content-Type": "application/rss+xml; charset=utf-8",
          },
        });
      },
    },
  },
});
