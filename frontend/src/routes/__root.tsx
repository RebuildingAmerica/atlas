import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import "@/styles/app.css";
import { Home, Globe, Zap } from "lucide-react";

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
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>The Atlas</title>
        </head>
        <body className="flex min-h-screen flex-col bg-gray-50 text-gray-900">
          <header className="border-b border-gray-200 bg-white">
            <div className="mx-auto max-w-7xl px-6 py-4">
              <nav className="flex items-center justify-between">
                <div className="flex items-center gap-8">
                  <Link
                    to="/"
                    className="flex items-center gap-2 text-xl font-bold text-blue-600 hover:text-blue-700"
                  >
                    <Globe className="h-6 w-6" />
                    The Atlas
                  </Link>

                  <div className="flex items-center gap-6">
                    <Link
                      to="/"
                      className="flex items-center gap-2 text-gray-700 transition-colors hover:text-gray-900"
                      activeProps={{ className: "text-blue-600 font-semibold" }}
                    >
                      <Home className="h-4 w-4" />
                      Dashboard
                    </Link>

                    <Link
                      to="/atlas"
                      className="flex items-center gap-2 text-gray-700 transition-colors hover:text-gray-900"
                      activeProps={{ className: "text-blue-600 font-semibold" }}
                    >
                      <Globe className="h-4 w-4" />
                      Browse
                    </Link>

                    <Link
                      to="/discovery"
                      className="flex items-center gap-2 text-gray-700 transition-colors hover:text-gray-900"
                      activeProps={{ className: "text-blue-600 font-semibold" }}
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

          <footer className="border-t border-gray-200 bg-white py-6">
            <div className="mx-auto max-w-7xl px-6 text-center text-sm text-gray-600">
              <p>The Atlas — Part of the Rebuilding America initiative</p>
            </div>
          </footer>
        </body>
      </html>
    </QueryClientProvider>
  );
}
