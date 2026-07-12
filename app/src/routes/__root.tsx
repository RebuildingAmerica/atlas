import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { NotFoundPage } from "@/platform/pages/not-found-page";
import { ErrorPage } from "@/platform/pages/error-page";
import "@/styles/app.css";

export interface AtlasRouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<AtlasRouterContext>()({
  component: RootDocument,
  notFoundComponent: NotFoundPage,
  errorComponent: ErrorPage,
});

function RootDocument() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="alternate icon" href="/favicon.ico" />
      </head>
      <body className="bg-background text-on-surface flex min-h-screen flex-col">
        <Outlet />
        <Scripts />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
