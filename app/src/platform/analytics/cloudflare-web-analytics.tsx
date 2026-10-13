interface CloudflareWebAnalyticsProps {
  token?: string;
}

/** Records aggregate page visits without attaching analytics to private API requests. */
export function CloudflareWebAnalytics({ token }: CloudflareWebAnalyticsProps) {
  const configuredToken: unknown = token ?? import.meta.env.VITE_CF_WEB_ANALYTICS_TOKEN;
  const siteToken = typeof configuredToken === "string" ? configuredToken.trim() : "";
  if (!siteToken) return null;

  return (
    <script
      type="module"
      src="https://static.cloudflareinsights.com/beacon.min.js"
      data-cf-beacon={JSON.stringify({ token: siteToken, spa: true })}
    />
  );
}
