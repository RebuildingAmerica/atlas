import { Link } from "@tanstack/react-router";
import { Compass, Search, Users } from "lucide-react";
import { useState } from "react";
import { getAuthConfig } from "@/domains/access/config";
import { PageLayout } from "@/platform/layout/page-layout";
import { Button } from "@/platform/ui/button";

interface HomeHeroActionsProps {
  query: string;
  onQueryChange: (value: string) => void;
}

function HomeHeroActions({ onQueryChange, query }: HomeHeroActionsProps) {
  return (
    <>
      <form action="/browse" className="mx-auto mt-8 max-w-2xl" method="get">
        <div className="border-border-strong shadow-soft rounded-[1.8rem] border bg-white/80 p-4">
          <div className="grid gap-3">
            <input type="hidden" name="offset" value="0" />
            <label className="border-border bg-surface flex items-center gap-3 rounded-[1.25rem] border px-4 py-4">
              <Search className="text-ink-muted h-4 w-4" />
              <input
                name="query"
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
          to="/profiles"
          className="type-label-large border-border-strong text-ink-strong hover:bg-surface-alt inline-flex items-center gap-2 rounded-full border px-5 py-2.5 transition-colors"
        >
          <Users className="h-4 w-4" />
          Browse profiles
        </Link>
        <Link
          to="/browse"
          className="type-label-large text-ink-muted hover:text-ink-strong inline-flex items-center gap-2 rounded-full px-3 py-2.5 transition-colors"
        >
          <Compass className="h-4 w-4" />
          Research browser
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
        <p className="type-title-small text-ink-strong">Profiles</p>
        <p className="type-body-medium text-ink-soft mt-1">
          Browse people and organizations by place and issue.
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

export function HomePage() {
  const { localMode } = getAuthConfig();
  const [query, setQuery] = useState("");

  return (
    <PageLayout className="flex min-h-[calc(100vh-11rem)] items-center py-10 lg:py-16">
      <section className="mx-auto w-full max-w-4xl">
        <div className="text-center">
          <p className="type-label-medium text-ink-muted">Atlas</p>

          <h1 className="type-display-large text-ink-strong mx-auto mt-4 max-w-3xl">
            Find the people and organizations rebuilding America.
          </h1>

          <p className="type-body-large text-ink-soft mx-auto mt-4 max-w-2xl">
            Search Atlas directly, browse profile directories by place and issue, or open the
            research browser when you want the broader civic graph.
          </p>

          <HomeHeroActions onQueryChange={setQuery} query={query} />
        </div>

        <HomeHighlights isLocal={localMode} />

        {!localMode ? (
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
