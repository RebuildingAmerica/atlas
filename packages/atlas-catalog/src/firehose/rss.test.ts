import { describe, expect, it } from "vitest";

describe("Firehose RSS builder", () => {
  it("renders public Firehose signals as escaped RSS items with source links", async () => {
    const { listPublicFirehoseSignals } = await import("./public-feed");
    const { buildFirehoseRss } = await import("./rss");
    const snapshot = listPublicFirehoseSignals({ place: "detroit-mi" });

    const xml = buildFirehoseRss(snapshot, "https://atlas.example/firehose.rss?place=detroit-mi");

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain("<title>Atlas Firehose</title>");
    expect(xml).toContain("<link>https://atlas.example/firehose?place=detroit-mi</link>");
    expect(xml).toContain('<guid isPermaLink="false">fh_public_detroit_hearing_agenda</guid>');
    expect(xml).toContain('<source url="https://detroit.example/agendas/night-bus">');
    expect(xml).not.toContain("<script>");
  });
});
