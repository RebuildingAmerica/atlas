import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Compass, KeyRound, Search, Zap } from "lucide-react";
import { useState } from "react";
import { PageLayout } from "@/platform/layout/page-layout";
import { Button } from "@/platform/ui/button";

export const Route = createFileRoute("/_public/")({
  ssr: false,
  component: HomePage,
});

function HomePage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const goToBrowse = () => {
    void navigate({
      to: "/browse",
      search: {
        query: query || undefined,
        offset: 0,
      },
    });
  };

  return (
    <PageLayout className="flex min-h-[calc(100vh-11rem)] items-center py-10 lg:py-16">
      <section className="mx-auto w-full max-w-4xl">
        <div className="text-center">
          <p className="type-label-medium text-[var(--ink-muted)]">Atlas</p>

          <h1 className="type-display-large mx-auto mt-4 max-w-3xl text-[var(--ink-strong)]">
            Find people, organizations, and initiatives.
          </h1>

          <p className="type-body-large mx-auto mt-4 max-w-2xl text-[var(--ink-soft)]">
            Search by name, place, issue area, or source type. Open a record to see the sources
            behind it.
          </p>

          <form
            className="mx-auto mt-8 max-w-2xl"
            onSubmit={(event) => {
              event.preventDefault();
              goToBrowse();
            }}
          >
            <div className="rounded-[1.8rem] border border-[var(--border-strong)] bg-white/80 p-4 shadow-[var(--shadow-soft)]">
              <div className="grid gap-3">
                <label className="flex items-center gap-3 rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface)] px-4 py-4">
                  <Search className="h-4 w-4 text-[var(--ink-muted)]" />
                  <input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                    }}
                    placeholder="Search housing in Detroit, labor in Kansas City, transit organizers"
                    className="type-body-large w-full bg-transparent text-[var(--ink-strong)] outline-none placeholder:text-[var(--ink-muted)]"
                  />
                </label>

                <div className="flex justify-center">
                  <Button
                    type="submit"
                    className="justify-center rounded-full bg-[var(--ink-strong)] px-8 text-[var(--surface)] hover:bg-[var(--ink)]"
                  >
                    Search Atlas
                  </Button>
                </div>
              </div>
            </div>
          </form>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/browse"
              className="type-label-large inline-flex items-center gap-2 rounded-full border border-[var(--border-strong)] px-5 py-2.5 text-[var(--ink-strong)] transition-colors hover:bg-[var(--surface-alt)]"
            >
              <Compass className="h-4 w-4" />
              Browse all entries
            </Link>

            <Link
              to="/discovery"
              className="type-label-large inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white/60 px-5 py-2.5 text-[var(--ink-soft)] transition-colors hover:bg-white"
            >
              <Zap className="h-4 w-4" />
              Open admin
            </Link>
            <Link
              to="/account"
              className="type-label-large inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-white/60 px-5 py-2.5 text-[var(--ink-soft)] transition-colors hover:bg-white"
            >
              <KeyRound className="h-4 w-4" />
              Account
            </Link>
          </div>
        </div>

        <div className="mt-12 grid gap-3 text-left sm:grid-cols-3">
          <div className="rounded-[1.4rem] border border-[var(--border)] bg-white/70 p-4">
            <p className="type-title-small text-[var(--ink-strong)]">Search</p>
            <p className="type-body-medium mt-1 text-[var(--ink-soft)]">
              Start with a person, group, issue, or city.
            </p>
          </div>
          <div className="rounded-[1.4rem] border border-[var(--border)] bg-white/70 p-4">
            <p className="type-title-small text-[var(--ink-strong)]">Browse</p>
            <p className="type-body-medium mt-1 text-[var(--ink-soft)]">
              Narrow results with filters and facets.
            </p>
          </div>
          <div className="rounded-[1.4rem] border border-[var(--border)] bg-white/70 p-4">
            <p className="type-title-small text-[var(--ink-strong)]">Verify</p>
            <p className="type-body-medium mt-1 text-[var(--ink-soft)]">
              Every entry links back to public sources.
            </p>
          </div>
        </div>
      </section>
    </PageLayout>
  );
}
