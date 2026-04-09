import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, HeadContent, Link, Outlet, Scripts } from "@tanstack/react-router";
import "@/styles/app.css";
import { LayoutDashboard, Globe, Zap, Search } from "lucide-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <html lang="en">
        <head>
          <HeadContent />
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>The Atlas</title>
        </head>
        <body className="flex min-h-screen flex-col bg-[#f3efe6] text-stone-900">
          <header className="border-b border-stone-300 bg-[#f8f2e7]">
            <div className="mx-auto max-w-7xl px-6 py-4">
              <nav className="flex items-center justify-between">
                <div className="flex items-center gap-8">
                  <Link
                    to="/"
                    className="flex items-center gap-2 text-xl font-semibold text-stone-950 transition-colors hover:text-stone-700"
                  >
                    <Globe className="h-6 w-6" />
                    The Atlas
                  </Link>

                  <div className="flex items-center gap-6 text-sm">
                    <Link
                      to="/"
                      className="flex items-center gap-2 text-stone-700 transition-colors hover:text-stone-950"
                      activeProps={{ className: "font-semibold text-stone-950" }}
                    >
                      <Search className="h-4 w-4" />
                      Browse
                    </Link>

                    <Link
                      to="/dashboard"
                      className="flex items-center gap-2 text-stone-700 transition-colors hover:text-stone-950"
                      activeProps={{ className: "font-semibold text-stone-950" }}
                    >
                      <LayoutDashboard className="h-4 w-4" />
                      Dashboard
                    </Link>

                    <Link
                      to="/discovery"
                      className="flex items-center gap-2 text-stone-700 transition-colors hover:text-stone-950"
                      activeProps={{ className: "font-semibold text-stone-950" }}
                    >
                      <Zap className="h-4 w-4" />
                      Discovery
                    </Link>
                  </div>
                </div>
              </nav>
            </div>
          </header>

          <main className="flex-1">
            <Outlet />
          </main>

          <footer className="border-t border-stone-300 bg-[#f8f2e7] py-6">
            <div className="mx-auto max-w-7xl px-6 text-center text-sm text-stone-600">
              <p>The Atlas — Part of the Rebuilding America initiative</p>
            </div>
          </footer>
          <Scripts />
        </body>
      </html>
    </QueryClientProvider>
  );
}
