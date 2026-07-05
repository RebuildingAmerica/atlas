import { Link } from "@tanstack/react-router";
import { Map, Search } from "lucide-react";
import { useState } from "react";
import { useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { PageLayout } from "@/platform/layout/page-layout";
import { Button } from "@/platform/ui/button";

interface HomeHeroActionsProps {
  query: string;
  onQueryChange: (value: string) => void;
}

const EXAMPLE_SEARCHES = [
  { label: "Housing in Detroit", query: "housing in Detroit" },
  { label: "Labor organizers in Kansas City", query: "labor organizers in Kansas City" },
  { label: "Transit groups near Phoenix", query: "transit groups near Phoenix" },
] as const;

function HomeHeroActions({ onQueryChange, query }: HomeHeroActionsProps) {
  return (
    <>
      <form action="/browse" className="mx-auto mt-8 max-w-2xl" method="get">
        <div className="border-border-strong shadow-soft rounded-[1.8rem] border bg-white/80 p-4">
          <div className="grid gap-3">
            <input type="hidden" name="offset" value="0" />
            <label className="border-border bg-surface flex items-center gap-3 rounded-[1.25rem] border px-4 py-4">
              <span className="sr-only">Search Atlas by issue, place, or name</span>
              <Search className="text-ink-muted h-4 w-4" />
              <input
                name="query"
                value={query}
                onChange={(event) => {
                  onQueryChange(event.target.value);
                }}
                placeholder="Try housing in Detroit"
                className="type-body-large text-ink-strong placeholder:text-ink-muted w-full bg-transparent outline-none"
              />
            </label>

            <div className="flex justify-center">
              <Button
                type="submit"
                className="bg-ink-strong text-surface hover:bg-ink justify-center rounded-full px-8"
              >
                Search
              </Button>
            </div>
          </div>
        </div>
      </form>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {EXAMPLE_SEARCHES.map((example) => (
          <Link
            key={example.query}
            to="/browse"
            search={{ query: example.query, offset: 0 }}
            className="type-label-large border-border-strong text-ink-strong hover:bg-surface-alt inline-flex items-center rounded-full border px-4 py-2 transition-colors"
          >
            {example.label}
          </Link>
        ))}
        <Link
          to="/map"
          className="type-label-large text-ink-muted hover:text-ink-strong inline-flex items-center gap-2 rounded-full px-3 py-2 transition-colors"
        >
          <Map className="h-4 w-4" />
          Open map
        </Link>
      </div>
    </>
  );
}

export function HomePage() {
  const session = useAtlasSession();
  const localMode = session.data?.isLocal ?? false;
  const isSignedIn = session.data !== null && session.data !== undefined && !localMode;
  const [query, setQuery] = useState("");

  return (
    <PageLayout className="flex min-h-[calc(100vh-11rem)] items-center py-10 lg:py-16">
      <section className="mx-auto w-full max-w-4xl">
        <div className="text-center">
          <h1 className="type-display-large text-ink-strong text-balance">
            Find people and groups doing civic work.
          </h1>

          <p className="type-body-large text-ink-soft mx-auto mt-4 max-w-2xl text-balance">
            Search by issue, place, or name.
          </p>

          <HomeHeroActions onQueryChange={setQuery} query={query} />

          <p className="type-body-medium text-ink-soft mt-5">Sources you can check.</p>
        </div>

        {isSignedIn ? (
          <div className="mt-8 flex justify-center">
            <Link
              to="/home"
              className="type-label-large bg-ink-strong text-surface hover:bg-ink inline-flex items-center justify-center rounded-full px-8 py-2.5 transition-colors"
            >
              Go to your research &rarr;
            </Link>
          </div>
        ) : !localMode ? (
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
