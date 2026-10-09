/** Suppress private requests and email credentials before either metrics provider sees them. */
export function excludePrivateAnalytics<T extends { url: string }>(event: T): T | null {
  const url = new URL(event.url, "https://atlas.invalid");
  if (
    url.pathname.startsWith("/waitlist") ||
    url.pathname.startsWith("/admin") ||
    url.searchParams.has("token") ||
    url.searchParams.has("email")
  )
    return null;
  return event;
}
