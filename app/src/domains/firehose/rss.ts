import {
  buildPublicFirehoseSearchParams,
  type PublicFirehoseSignal,
  type PublicFirehoseSnapshot,
} from "./public-feed";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function firehosePageUrl(snapshot: PublicFirehoseSnapshot, requestUrl: string): string {
  const url = new URL(requestUrl);
  url.pathname = "/firehose";
  url.search = buildPublicFirehoseSearchParams(snapshot.query).toString();
  return url.toString();
}

function itemXml(signal: PublicFirehoseSignal): string {
  const labels = [
    ...signal.places.map((place) => place.label),
    ...signal.issues.map((issue) => issue.label),
  ].join(" · ");
  const description = `${signal.summary} Source: ${signal.evidence.passage}`;

  return `    <item>
      <guid isPermaLink="false">${escapeXml(signal.id)}</guid>
      <title>${escapeXml(signal.title)}</title>
      <link>${escapeXml(signal.evidence.source_url)}</link>
      <description>${escapeXml(description)}</description>
      <pubDate>${new Date(signal.detected_at).toUTCString()}</pubDate>
      <category>${escapeXml(signal.signal_type)}</category>
      <category>${escapeXml(labels)}</category>
      <source url="${escapeXml(signal.evidence.source_url)}">${escapeXml(signal.evidence.publisher)}</source>
    </item>`;
}

export function buildFirehoseRss(snapshot: PublicFirehoseSnapshot, requestUrl: string): string {
  const pageUrl = firehosePageUrl(snapshot, requestUrl);
  const latestDate = snapshot.summary.latest_detected_at
    ? new Date(snapshot.summary.latest_detected_at).toUTCString()
    : new Date(snapshot.generated_at).toUTCString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Atlas Firehose</title>
    <link>${escapeXml(pageUrl)}</link>
    <description>Source-backed public civic signals from Atlas.</description>
    <lastBuildDate>${latestDate}</lastBuildDate>
${snapshot.signals.map(itemXml).join("\n")}
  </channel>
</rss>`;
}
