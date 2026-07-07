import { describe, expect, it, vi } from "vitest";

describe("public Firehose feed provider", () => {
  it("fetches public signals from the Firehose API", async () => {
    const { fetchPublicFirehoseSignals, listPublicFirehoseSignals } =
      await import("@/domains/firehose/public-feed");
    const snapshot = listPublicFirehoseSignals({
      issue: "transit",
      limit: 1,
      place: "detroit-mi",
      signal_type: "public_meeting",
      source_class: "government_agenda",
    });
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(snapshot), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );

    const result = await fetchPublicFirehoseSignals(
      {
        issue: "transit",
        limit: "1",
        place: "detroit-mi",
        signal_type: "public_meeting",
        source_class: "government_agenda",
      },
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "/api/firehose/public?place=detroit-mi&issue=transit&signal_type=public_meeting&source_class=government_agenda&limit=1",
      { headers: { Accept: "application/json" } },
    );
    expect(result).toEqual(snapshot);
  });

  it("returns only public-safe signals newest first", async () => {
    const { listPublicFirehoseSignals } = await import("@/domains/firehose/public-feed");

    const snapshot = listPublicFirehoseSignals({});

    expect(snapshot.signals.length).toBeGreaterThan(1);
    expect(snapshot.signals.map((signal) => signal.id)).toEqual([
      "fh_public_detroit_hearing_agenda",
      "fh_public_las_vegas_coalition",
      "fh_public_kansas_city_grant",
    ]);
    expect(snapshot.signals.every((signal) => signal.visibility === "public")).toBe(true);
    expect(snapshot.signals.every((signal) => signal.review_state === "not_required")).toBe(true);
    expect(snapshot.summary.visible_signals).toBe(3);
  });

  it("filters by place, issue, signal type, source class, and limit", async () => {
    const { listPublicFirehoseSignals } = await import("@/domains/firehose/public-feed");

    const snapshot = listPublicFirehoseSignals({
      issue: "transit",
      limit: 1,
      place: "detroit-mi",
      signal_type: "public_meeting",
      source_class: "government_agenda",
    });

    expect(snapshot.signals).toHaveLength(1);
    expect(snapshot.signals[0]?.id).toBe("fh_public_detroit_hearing_agenda");
    expect(snapshot.query).toEqual({
      issue: ["transit"],
      limit: 1,
      place: ["detroit-mi"],
      signal_type: ["public_meeting"],
      source_class: ["government_agenda"],
    });
  });

  it("dedupes socket signals before prepending them to the feed", async () => {
    const { mergePublicFirehoseSignal, listPublicFirehoseSignals } =
      await import("@/domains/firehose/public-feed");
    const snapshot = listPublicFirehoseSignals({ limit: 2 });
    const duplicate = snapshot.signals[1];
    if (!duplicate) throw new Error("Expected duplicate fixture signal");

    const merged = mergePublicFirehoseSignal(snapshot.signals, duplicate);

    expect(merged).toHaveLength(2);
    expect(merged.map((signal) => signal.id)).toEqual(snapshot.signals.map((signal) => signal.id));
  });
});
