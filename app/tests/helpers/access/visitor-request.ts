/** Builds a page request as it reaches the app server behind one proxy hop. */
export function visitorRequest(forwardedFor: string | null): Request {
  return new Request("https://atlas.test/browse", {
    headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
  });
}
