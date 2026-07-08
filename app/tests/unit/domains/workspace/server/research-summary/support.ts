import { expect } from "vitest";
import type { ResearchSummary } from "@/domains/workspace/server/research-summary";
import type { ServerFnExecutionResponse } from "../../../../../helpers/server-fn-stub";

export interface RawList {
  id: string;
  name: string;
  description?: string | null;
  item_count?: number;
}

export interface RawFeedItem {
  entry_id: string;
  entry_name: string;
  entry_slug?: string | null;
  entry_type: string;
  source_id: string;
  source_url: string;
  source_title?: string | null;
  source_publication?: string | null;
  ingested_at: string;
}

export interface RawRun {
  id: string;
  location_query: string;
  state: string;
  status: string;
  started_at: string;
  issue_areas: string[];
}

export const REFERENCE_NOW = Date.parse("2026-06-24T00:00:00.000Z");

export function isoDaysAgo(days: number): string {
  return new Date(REFERENCE_NOW - days * 24 * 60 * 60 * 1000).toISOString();
}

export function makeList(overrides: Partial<RawList> = {}): RawList {
  return { id: "list_1", name: "Climate", description: "Greens", item_count: 4, ...overrides };
}

export function makeFeedItem(overrides: Partial<RawFeedItem> = {}): RawFeedItem {
  return {
    entry_id: "entry_1",
    entry_name: "Jane Doe",
    entry_slug: "jane-doe",
    entry_type: "person",
    source_id: "src_1",
    source_url: "https://example.test/a",
    source_title: "A headline",
    source_publication: "Local Paper",
    ingested_at: isoDaysAgo(1),
    ...overrides,
  };
}

export function makeRun(overrides: Partial<RawRun> = {}): RawRun {
  return {
    id: "run_1",
    location_query: "Kansas City, MO",
    state: "MO",
    status: "completed",
    started_at: isoDaysAgo(2),
    issue_areas: ["housing_affordability"],
    ...overrides,
  };
}

export async function executeLoader(): Promise<ServerFnExecutionResponse<ResearchSummary>> {
  const { loadResearchSummary } = await import("@/domains/workspace/server/research-summary");
  return (await loadResearchSummary.__executeServer({
    data: undefined,
    method: "GET",
  })) as ServerFnExecutionResponse<ResearchSummary>;
}

export function expectSummary(
  response: ServerFnExecutionResponse<ResearchSummary>,
): ResearchSummary {
  expect(response.error).toBeUndefined();
  const { result } = response;
  if (!result) {
    throw new Error("expected a research summary result");
  }
  return result;
}
