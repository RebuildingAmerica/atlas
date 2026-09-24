export function safeWebsiteHref(website: string): string | null {
  try {
    const url = new URL(website);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
