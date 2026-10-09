import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { AdminFrame } from "@/platform/admin-frame";
import "@/styles/admin.css";

export interface AdminRouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<AdminRouterContext>()({
  head: () => ({
    meta: [
      { title: "Atlas platform admin" },
      // The admin is private; nothing here should ever be indexed.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: RootDocument,
});

function RootDocument() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className="bg-background text-on-surface min-h-screen">
        <AdminFrame>
          <Outlet />
        </AdminFrame>
        <Scripts />
      </body>
    </html>
  );
}
