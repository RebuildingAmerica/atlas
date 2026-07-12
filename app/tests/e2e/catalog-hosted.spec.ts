import { expect, test } from "@playwright/test";
import {
  absoluteHostedUrl,
  hostedPublicRequestInit,
  requiredHostedOrigin,
} from "../helpers/hosted-endpoints";

const shouldExpectHostedCatalog = process.env.ATLAS_HOSTED_EXPECT_CATALOG === "true";

type EntityType = "person" | "organization";

interface CatalogItem {
  name: string;
  slug: string;
  sourceCount: number;
  type: EntityType;
}

interface CatalogSummary {
  items: CatalogItem[];
  total: number;
}

interface MapSummary {
  points: CatalogItem[];
  total: number;
}

interface SourceReceipt {
  title: string;
  url: string;
}

interface EntityDetail {
  name: string;
  sourceCount: number;
  sources: SourceReceipt[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Expected ${key} to be a non-empty string.`);
  }
  return value;
}

function requireNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number") {
    throw new Error(`Expected ${key} to be a number.`);
  }
  return value;
}

function parseEntityType(record: Record<string, unknown>): EntityType {
  const value = requireString(record, "type");
  if (value !== "person" && value !== "organization") {
    throw new Error(`Expected entity type to be person or organization, got ${value}.`);
  }
  return value;
}

function parseCatalogItem(value: unknown): CatalogItem {
  if (!isRecord(value)) {
    throw new Error("Expected catalog item to be an object.");
  }
  return {
    name: requireString(value, "name"),
    slug: requireString(value, "slug"),
    sourceCount: requireNumber(value, "source_count"),
    type: parseEntityType(value),
  };
}

function parseCatalogSummary(value: unknown): CatalogSummary {
  if (!isRecord(value)) {
    throw new Error("Expected catalog response to be an object.");
  }
  const items = value.items;
  if (!Array.isArray(items)) {
    throw new Error("Expected catalog response to include items.");
  }
  return {
    items: items.map(parseCatalogItem),
    total: requireNumber(value, "total"),
  };
}

function parseMapSummary(value: unknown): MapSummary {
  if (!isRecord(value)) {
    throw new Error("Expected map response to be an object.");
  }
  const points = value.points;
  if (!Array.isArray(points)) {
    throw new Error("Expected map response to include points.");
  }
  return {
    points: points.map(parseCatalogItem),
    total: requireNumber(value, "total"),
  };
}

function parseSourceReceipt(value: unknown): SourceReceipt {
  if (!isRecord(value)) {
    throw new Error("Expected source receipt to be an object.");
  }
  return {
    title: requireString(value, "title"),
    url: requireString(value, "url"),
  };
}

function parseEntityDetail(value: unknown): EntityDetail {
  if (!isRecord(value)) {
    throw new Error("Expected entity detail response to be an object.");
  }
  const sources = value.sources;
  if (!Array.isArray(sources)) {
    throw new Error("Expected entity detail response to include sources.");
  }
  return {
    name: requireString(value, "name"),
    sourceCount: requireNumber(value, "source_count"),
    sources: sources.map(parseSourceReceipt),
  };
}

async function parseJsonResponse(response: Response, label: string): Promise<unknown> {
  const body = await response.text();
  expect(response.status, label).toBe(200);
  expect(body.length, `${label} body length`).toBeGreaterThan(0);
  return JSON.parse(body) as unknown;
}

function entityDetailPath(item: CatalogItem): string {
  const collection = item.type === "person" ? "people" : "organizations";
  return `/api/entities/by-slug/${collection}/${item.slug}`;
}

function firstItem<T>(items: T[], label: string): T {
  const [item] = items;
  if (item === undefined) {
    throw new Error(`Expected ${label} to include at least one item.`);
  }
  return item;
}

test.describe("hosted public catalog", () => {
  test.skip(
    !shouldExpectHostedCatalog,
    "Set ATLAS_HOSTED_EXPECT_CATALOG=true once production is expected to expose vetted catalog data.",
  );

  test("serves populated catalog JSON, map points, and source receipts", async () => {
    const apiOrigin = requiredHostedOrigin("ATLAS_HOSTED_API_URL");
    const publicOrigin = requiredHostedOrigin("ATLAS_HOSTED_PUBLIC_URL");
    const catalogPath = "/api/entities?limit=1";
    const mapPath = "/api/entities/map?min_lng=-125&min_lat=24&max_lng=-66&max_lat=50&limit=5";

    const apiCatalog = parseCatalogSummary(
      await parseJsonResponse(
        await fetch(absoluteHostedUrl(apiOrigin, catalogPath)),
        "direct API catalog",
      ),
    );
    const publicCatalog = parseCatalogSummary(
      await parseJsonResponse(
        await fetch(absoluteHostedUrl(publicOrigin, catalogPath), hostedPublicRequestInit()),
        "public app catalog",
      ),
    );
    const map = parseMapSummary(
      await parseJsonResponse(
        await fetch(absoluteHostedUrl(publicOrigin, mapPath), hostedPublicRequestInit()),
        "public app map",
      ),
    );

    expect(apiCatalog.total).toBeGreaterThan(0);
    expect(apiCatalog.items.length).toBeGreaterThan(0);
    expect(publicCatalog.total).toBe(apiCatalog.total);
    expect(publicCatalog.items.length).toBeGreaterThan(0);
    const publicCatalogItem = firstItem(publicCatalog.items, "public catalog");
    expect(publicCatalogItem.sourceCount).toBeGreaterThan(0);
    expect(map.total).toBeGreaterThan(0);
    expect(map.points.length).toBeGreaterThan(0);

    const detail = parseEntityDetail(
      await parseJsonResponse(
        await fetch(
          absoluteHostedUrl(publicOrigin, entityDetailPath(publicCatalogItem)),
          hostedPublicRequestInit(),
        ),
        "public app entity detail",
      ),
    );

    expect(detail.name).toBe(publicCatalogItem.name);
    expect(detail.sourceCount).toBeGreaterThan(0);
    expect(detail.sources.length).toBeGreaterThan(0);
    expect(firstItem(detail.sources, "entity detail sources").url).toMatch(/^https?:\/\//);
  });
});
