import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Compass, Search } from "lucide-react";
import { useState } from "react";
import { useAtlasSession } from "@/domains/access";
import { PageLayout } from "@/platform/layout/page-layout";
import { Button } from "@/platform/ui/button";

/**
 * Props for the public homepage action row.
 */
interface HomeHeroActionsProps {
  onSearch: () => void;
  query: string;
  onQueryChange: (value: string) => void;
}

function HomeHeroActions({ onQueryChange, onSearch, query }: HomeHeroActionsProps) {
  return (
    <>
      <form
        className="mx-auto mt-8 max-w-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
      >
        <div className="border-border-strong shadow-soft rounded-[1.8rem] border bg-white/80 p-4">
          <div className="grid gap-3">
            <label className="border-border bg-surface flex items-center gap-3 rounded-[1.25rem] border px-4 py-4">
              <Search className="text-ink-muted h-4 w-4" />
              <input
                value={query}
                onChange={(event) => {
                  onQueryChange(event.target.value);
                }}
                placeholder="Search housing in Detroit, labor in Kansas City, transit organizers"
                className="type-body-large text-ink-strong placeholder:text-ink-muted w-full bg-transparent outline-none"
              />
            </label>

            <div className="flex justify-center">
              <Button
                type="submit"
                className="bg-ink-strong text-surface hover:bg-ink justify-center rounded-full px-8"
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
          className="type-label-large border-border-strong text-ink-strong hover:bg-surface-alt inline-flex items-center gap-2 rounded-full border px-5 py-2.5 transition-colors"
        >
          <Compass className="h-4 w-4" />
          Browse all entries
        </Link>
      </div>
    </>
  );
}

function HomeHighlights({ isLocal }: { isLocal: boolean }) {
  return (
    <div className="mt-12 grid gap-3 text-left sm:grid-cols-3">
      <div className="border-border rounded-[1.4rem] border bg-white/70 p-4">
        <p className="type-title-small text-ink-strong">Search</p>
        <p className="type-body-medium text-ink-soft mt-1">
          Start with a person, group, issue, or city.
        </p>
      </div>
      <div className="border-border rounded-[1.4rem] border bg-white/70 p-4">
        <p className="type-title-small text-ink-strong">Browse</p>
        <p className="type-body-medium text-ink-soft mt-1">
          Narrow results with filters and facets.
        </p>
      </div>
      <div className="border-border rounded-[1.4rem] border bg-white/70 p-4">
        <p className="type-title-small text-ink-strong">{isLocal ? "Verify" : "Save"}</p>
        <p className="type-body-medium text-ink-soft mt-1">
          {isLocal
            ? "Every entry links back to public sources."
            : "Create a free account to save research."}
        </p>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_public/")({
  ssr: false,
  component: HomePage,
});

function HomePage() {
  const navigate = useNavigate();
  const { data: session } = useAtlasSession();
  const isLocal = session?.isLocal ?? false;
  const [query, setQuery] = useState("");

  const goToBrowse = () => {
    const navigationPromise = navigate({
      search: {
        offset: 0,
        query: query || undefined,
      },
      to: "/browse",
    });
    navigationPromise.catch(() => undefined);
  };

  return (
    <PageLayout className="flex min-h-[calc(100vh-11rem)] items-center py-10 lg:py-16">
      <section className="mx-auto w-full max-w-4xl">
        <div className="text-center">
          <p className="type-label-medium text-ink-muted">Atlas</p>

          <h1 className="type-display-large text-ink-strong mx-auto mt-4 max-w-3xl">
            Find people, organizations, and initiatives.
          </h1>

          <p className="type-body-large text-ink-soft mx-auto mt-4 max-w-2xl">
            Search by name, place, issue area, or source type. Open a record to see the sources
            behind it.
          </p>

          <HomeHeroActions onQueryChange={setQuery} onSearch={goToBrowse} query={query} />
        </div>

        <HomeHighlights isLocal={isLocal} />

        {!isLocal ? (
          <p className="type-body-medium text-ink-soft mt-6 text-center">
            Want to save your work?{" "}
            <Link to="/sign-up" className="text-accent type-label-medium hover:underline">
              Create a free account &rarr;
            </Link>
          </p>
        ) : null}
      </section>
    </PageLayout>
  );
}
