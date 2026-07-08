import { useState } from "react";
import { useAtlasSession } from "@/domains/access/client/use-atlas-session";
import { useEntries } from "@/domains/catalog/hooks/use-entries";
import { HomePageShell } from "./home-page-sections";

export function HomePage() {
  const session = useAtlasSession();
  const localMode = session.data?.isLocal ?? false;
  const isSignedIn = session.data !== null && session.data !== undefined && !localMode;
  const [query, setQuery] = useState("");
  const recentEntries = useEntries({ limit: 16, offset: 0 });
  const entries = recentEntries.data?.data ?? [];
  const totalEntries = recentEntries.data?.pagination.total;
  const organizationCount = recentEntries.data?.facets.entity_types?.find(
    (facet) => facet.value === "organization",
  )?.count;
  const stateCount = recentEntries.data?.facets.states?.length;

  return (
    <HomePageShell
      entries={entries}
      isSignedIn={isSignedIn}
      localMode={localMode}
      onQueryChange={setQuery}
      query={query}
      recentEntriesLoading={recentEntries.isLoading}
      stateCount={stateCount}
      totalEntries={totalEntries}
      organizationCount={organizationCount}
    />
  );
}
