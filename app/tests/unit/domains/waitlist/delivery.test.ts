import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATLAS_MIGRATIONS,
  runAtlasCustomMigrations,
} from "@/domains/access/server/atlas-migrations";
import { sqliteWaitlistDatabase } from "@/domains/waitlist/server/database";
import { WaitlistStore } from "@/domains/waitlist/server/store";
import { WaitlistMailer } from "@/domains/waitlist/server/delivery";
vi.mock("@tanstack/react-start/server-only", () => ({}));

describe("durable invitation email", () => {
  let db: Database.Database;
  let store: WaitlistStore;
  beforeEach(() => {
    db = new Database(":memory:");
    runAtlasCustomMigrations(db, ATLAS_MIGRATIONS);
    store = new WaitlistStore(sqliteWaitlistDatabase(db));
  });
  afterEach(() => {
    vi.useRealTimers();
    db.close();
  });
  it("encrypts links and deduplicates repeated invitation sends", async () => {
    const messages: string[] = [];
    const mailer = new WaitlistMailer(
      store.database,
      {
        send(message) {
          messages.push(message.text);
          return Promise.resolve("provider-1");
        },
      },
      "secret-for-tests",
      "https://atlas.example.org",
    );
    const request = await store.submit({ email: "person@example.org", product: "atlas_pro" });
    await store.confirm(await store.createLink(request.id, "confirm"));
    const invited = await store.invite(request.id, "staff");
    const link = await store.createLink(request.id, "invite");
    await mailer.sendLink(invited, "invite", link, `invite:${request.id}:${invited.invitedAt}`);
    await mailer.sendLink(
      invited,
      "invite",
      "different-token",
      `invite:${request.id}:${invited.invitedAt}`,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Atlas Pro");
    expect(messages[0]).toContain(link);
    const [delivery] = await mailer.list(request.id);
    expect(delivery).toMatchObject({ status: "sent", providerId: "provider-1", attempts: 1 });
    expect(JSON.stringify(db.prepare("SELECT * FROM waitlist_deliveries").all())).not.toContain(
      link,
    );
  });
  it("retains failed delivery and retries without granting paid functionality", async () => {
    let available = false;
    const mailer = new WaitlistMailer(
      store.database,
      {
        send() {
          return available ? Promise.resolve(undefined) : Promise.reject(new TypeError("network"));
        },
      },
      "secret-for-tests",
      "https://atlas.example.org",
    );
    const request = await store.submit({ email: "person@example.org", product: "atlas_team" });
    const result = await mailer.sendLink(
      request,
      "confirm",
      await store.createLink(request.id, "confirm"),
    );
    expect(result.status).toBe("unresolved");
    expect(await store.isAdmitted(request.email, request.product)).toBe(false);
    available = true;
    expect((await mailer.retry(result.id)).status).toBe("sent");
  });
  it("bounds a stalled provider and records an unresolved delivery for staff recovery", async () => {
    const send = vi.fn(
      () =>
        new Promise<undefined>(() => {
          /* A provider that never settles. */
        }),
    );
    const mailer = new WaitlistMailer(
      store.database,
      { send },
      "secret",
      "https://atlas.example.org",
      10,
    );
    const request = await store.submit({ email: "slow@example.org", product: "atlas_pro" });
    const sending = mailer.sendLink(
      request,
      "confirm",
      await store.createLink(request.id, "confirm"),
    );
    expect((await sending).status).toBe("unresolved");
  });
  it("records permanent rejection and requires a fresh resend outside provider dedupe retention", async () => {
    const { EmailDeliveryRejected } = await import("@/platform/email/server/service");
    const mailer = new WaitlistMailer(
      store.database,
      { send: () => Promise.reject(new EmailDeliveryRejected("rejected")) },
      "secret",
      "https://atlas.example.org",
    );
    const request = await store.submit({ email: "bad@example.org", product: "atlas_pro" });
    const delivery = await mailer.sendLink(
      request,
      "manage",
      await store.createLink(request.id, "manage"),
    );
    expect(delivery.status).toBe("failed");
    vi.useFakeTimers();
    vi.advanceTimersByTime(24 * 3600_000);
    await expect(mailer.retry(delivery.id)).rejects.toThrow("explicit resend");
    await expect(mailer.retry("missing")).rejects.toThrow("unavailable");
  });
  it("fails explicitly without encryption or when a queued message cannot be retained", async () => {
    expect(
      () =>
        new WaitlistMailer(
          store.database,
          { send: () => Promise.resolve(undefined) },
          "",
          "https://atlas.test",
        ),
    ).toThrow("encryption");
    const request = await store.submit({ email: "person@example.org", product: "atlas_pro" });
    db.exec(
      "CREATE TRIGGER reject_delivery BEFORE INSERT ON waitlist_deliveries BEGIN SELECT RAISE(IGNORE); END;",
    );
    const mailer = new WaitlistMailer(
      store.database,
      { send: () => Promise.resolve(undefined) },
      "secret",
      "https://atlas.test",
    );
    await expect(mailer.sendLink(request, "confirm", "token")).rejects.toThrow(
      "could not be queued",
    );
  });
  it("keeps an active send claimed, reclaims a stale attempt, and reports secret rotation failure", async () => {
    const send = vi.fn(() => Promise.reject(new Error("network")));
    const mailer = new WaitlistMailer(store.database, { send }, "secret", "https://atlas.test");
    const request = await store.submit({ email: "person@example.org", product: "atlas_pro" });
    const delivery = await mailer.sendLink(request, "confirm", "token");
    send.mockClear();
    db.prepare("UPDATE waitlist_deliveries SET status = 'sending' WHERE id = ?").run(delivery.id);
    expect((await mailer.retry(delivery.id)).status).toBe("sending");
    expect(send).not.toHaveBeenCalled();
    db.prepare("UPDATE waitlist_deliveries SET updated_at = ? WHERE id = ?").run(
      new Date(Date.now() - 65_000).toISOString(),
      delivery.id,
    );
    expect((await mailer.retry(delivery.id)).status).toBe("unresolved");
    const rotated = new WaitlistMailer(
      store.database,
      { send },
      "new-secret",
      "https://atlas.test",
    );
    expect((await rotated.retry(delivery.id)).status).toBe("unresolved");
  });
  it("does not overwrite a newer accepted result after a delayed sender returns", async () => {
    const request = await store.submit({ email: "person@example.org", product: "atlas_pro" });
    const mailer = new WaitlistMailer(
      store.database,
      {
        send() {
          db.prepare(
            "UPDATE waitlist_deliveries SET status = 'sent', provider_id = 'newer', attempts = attempts + 1",
          ).run();
          return Promise.resolve("older");
        },
      },
      "secret",
      "https://atlas.test",
    );
    expect(await mailer.sendLink(request, "invite", "token")).toMatchObject({
      status: "sent",
      providerId: "newer",
    });
  });
  it("fails explicitly when the delivery disappears during a provider send", async () => {
    const request = await store.submit({ email: "person@example.org", product: "atlas_pro" });
    const mailer = new WaitlistMailer(
      store.database,
      {
        send() {
          db.prepare("DELETE FROM waitlist_deliveries").run();
          return Promise.resolve("provider");
        },
      },
      "secret",
      "https://atlas.test",
    );
    await expect(mailer.sendLink(request, "invite", "token")).rejects.toThrow(
      "record is unavailable",
    );
  });
  it("retains uncertainty when an unresolved attempt is followed by a rejection", async () => {
    const { EmailDeliveryRejected } = await import("@/platform/email/server/service");
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockRejectedValueOnce(new EmailDeliveryRejected("rejected"));
    const mailer = new WaitlistMailer(store.database, { send }, "secret", "https://atlas.test");
    const request = await store.submit({ email: "person@example.org", product: "atlas_pro" });
    expect((await mailer.sendLink(request, "invite", "token")).status).toBe("unresolved");
  });

  it("reports an unreadable unsent message as failed after a secret rotation", async () => {
    const { EmailDeliveryRejected } = await import("@/platform/email/server/service");
    const send = () => Promise.reject(new EmailDeliveryRejected("rejected"));
    const request = await store.submit({ email: "person@example.org", product: "atlas_pro" });
    const original = new WaitlistMailer(store.database, { send }, "secret", "https://atlas.test");
    const delivery = await original.sendLink(request, "invite", "token");
    const rotated = new WaitlistMailer(
      store.database,
      { send },
      "new-secret",
      "https://atlas.test",
    );
    expect((await rotated.retry(delivery.id)).status).toBe("failed");
  });
});
