/** Keep old operator bookmarks useful after the platform and editorial split. */
export function legacyAdminResponse(
  request: Request,
  adminOrigin: string | undefined,
): Response | null {
  const url = new URL(request.url);
  if (url.pathname !== "/admin" && !url.pathname.startsWith("/admin/")) return null;
  const platformPage = ["waitlist", "discounts", "cloud-costs"].find(
    (page) => url.pathname === `/admin/${page}` || url.pathname.startsWith(`/admin/${page}/`),
  );
  let destination = url;
  if (platformPage) {
    try {
      const admin = new URL(adminOrigin ?? "");
      if (
        admin.protocol !== "https:" ||
        admin.pathname !== "/" ||
        admin.search ||
        admin.hash ||
        admin.username ||
        admin.password
      )
        throw new Error("Invalid platform admin origin.");
      destination = new URL(admin.origin);
      destination.pathname = url.pathname.slice("/admin".length);
      destination.search = url.search;
    } catch {
      return new Response("Service unavailable.", {
        status: 503,
        headers: { "cache-control": "private, no-store" },
      });
    }
  } else {
    destination.pathname = "/editorial" + url.pathname.slice("/admin".length);
  }
  return new Response(null, {
    status: 308,
    headers: { location: destination.href, "cache-control": "private, no-store" },
  });
}
