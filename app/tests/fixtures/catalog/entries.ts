import type { Entry, Source } from "@/types";

/**
 * Builds a baseline person `Entry` fixture used by profile component tests.
 *
 * @param overrides - Partial fields that should replace the default values.
 */
export function createEntryFixture(overrides: Partial<Entry> = {}): Entry {
  return {
    id: "entry-1",
    type: "person",
    name: "Jane Doe",
    description: "Community organizer focused on housing.",
    city: "Jackson",
    state: "MS",
    geo_specificity: "local",
    first_seen: "2024-01-01T00:00:00Z",
    last_seen: "2026-04-01T00:00:00Z",
    active: true,
    verified: false,
    claim: { status: "unclaimed", verification_level: "source-derived" },
    issue_areas: ["housing_affordability"],
    source_types: [],
    source_count: 3,
    slug: "jane-doe-a3f2",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

/**
 * Builds a baseline `Source` fixture used by profile component tests.
 *
 * @param overrides - Partial fields that should replace the default values.
 */
export function createSourceFixture(overrides: Partial<Source> = {}): Source {
  return {
    id: "source-1",
    url: "https://example.com/article",
    title: "Article title",
    publication: "Mississippi Today",
    published_date: "2026-02-01",
    type: "news_article",
    ingested_at: "2026-02-01T00:00:00Z",
    extraction_method: "ai_assisted",
    extraction_context: "Jane Doe leads the housing fight.",
    created_at: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}
