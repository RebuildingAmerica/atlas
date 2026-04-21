import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import "@/styles/app.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 30,
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 1000 * 60 * 5,
    },
  },
});

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => {
    return (
      <div className="flex flex-1 flex-col items-center justify-center space-y-4 p-8">
        <h1 className="text-4xl font-bold tracking-tight">404</h1>
        <p className="text-muted-foreground text-lg">
          We couldn't find the page you're looking for.
        </p>
        <a href="/" className="text-primary hover:underline">
          Return to home
        </a>
      </div>
    );
  },
});

function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <RootDocument />
    </QueryClientProvider>
  );
}

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
      <body className="text-ink flex min-h-screen flex-col">
        <Outlet />
        <Scripts />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
