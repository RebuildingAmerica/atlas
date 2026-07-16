import { describe, expect, it } from "vitest";
import { makeFirehoseSignal } from "../testing/firehose/signals";

describe("Firehose feed model", () => {
  it("groups high-volume signals into stable time buckets and jump targets", async () => {
    const { buildFirehoseFeedModel } = await import("./feed-model");
    const { listPublicFirehoseSignals } = await import("./public-feed");
    const base = listPublicFirehoseSignals({ place: "detroit-mi" }).signals[0];
    if (!base) throw new Error("Expected fixture signal");

    const signals = [
      makeFirehoseSignal(base, "now-1", "2026-07-06T22:10:00Z"),
      makeFirehoseSignal(base, "fifteen-1", "2026-07-06T22:00:00Z"),
      makeFirehoseSignal(base, "hour-1", "2026-07-06T21:30:00Z", {
        issues: [{ label: "Housing", slug: "housing" }],
        places: [{ label: "Las Vegas, NV", slug: "las-vegas-nv" }],
      }),
      makeFirehoseSignal(base, "earlier-1", "2026-07-06T19:00:00Z", {
        evidence: { ...base.evidence, publisher: "Heartland Civic Fund" },
        issues: [{ label: "Climate", slug: "climate" }],
      }),
    ];

    const model = buildFirehoseFeedModel(signals);

    expect(model.totalSignals).toBe(4);
    expect(model.buckets.map((bucket) => [bucket.id, bucket.count])).toEqual([
      ["now", 1],
      ["last_15m", 1],
      ["last_hour", 1],
      ["earlier_today", 1],
    ]);
    expect(model.items.map((item) => item.kind)).toEqual([
      "bucket",
      "signal",
      "bucket",
      "signal",
      "bucket",
      "signal",
      "bucket",
      "signal",
    ]);
    expect(model.jumpTargets.filter((target) => target.kind === "time")).toHaveLength(4);
    expect(model.jumpTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ count: 2, kind: "issue", label: "Transit" }),
        expect.objectContaining({ count: 1, kind: "place", label: "Las Vegas, NV" }),
        expect.objectContaining({ count: 1, kind: "source", label: "Heartland Civic Fund" }),
      ]),
    );
  });

  it("buffers incoming signals when the reader is away from the latest items", async () => {
    const { applyIncomingFirehoseSignal, flushPendingFirehoseSignals } =
      await import("./feed-model");
    const { listPublicFirehoseSignals } = await import("./public-feed");
    const base = listPublicFirehoseSignals({ place: "detroit-mi" }).signals[0];
    if (!base) throw new Error("Expected fixture signal");
    const incoming = makeFirehoseSignal(base, "incoming", "2026-07-06T22:11:00Z");

    const buffered = applyIncomingFirehoseSignal(
      { pendingSignals: [], signals: [base] },
      incoming,
      false,
    );
    expect(buffered.signals.map((signal) => signal.id)).toEqual([base.id]);
    expect(buffered.pendingSignals.map((signal) => signal.id)).toEqual(["incoming"]);

    const flushed = flushPendingFirehoseSignals(buffered);
    expect(flushed.pendingSignals).toEqual([]);
    expect(flushed.signals.map((signal) => signal.id)).toEqual(["incoming", base.id]);
  });
});
