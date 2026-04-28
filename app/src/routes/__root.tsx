import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { NotFoundPage } from "@/platform/pages/not-found-page";
import { ErrorPage } from "@/platform/pages/error-page";
import "@/styles/app.css";

export const Route = createRootRoute({
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
        <meta
          name="description"
          content="Atlas helps you find people and organizations by place, issue, and source."
        />
        <title>The Atlas</title>
      </head>
      <body className="text-on-surface-variant flex min-h-screen flex-col">
        <Outlet />
        <Scripts />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
