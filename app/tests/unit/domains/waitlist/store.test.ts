import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATLAS_MIGRATIONS,
  runAtlasCustomMigrations,
} from "@/domains/access/server/atlas-migrations";
import { WaitlistStore } from "@/domains/waitlist/server/store";
import { sqliteWaitlistDatabase } from "@/domains/waitlist/server/database";

vi.mock("@tanstack/react-start/server-only", () => ({}));

describe("waitlist lifecycle", () => {
  let database: Database.Database;
  let store: WaitlistStore;
  beforeEach(() => {
    database = new Database(":memory:");
    runAtlasCustomMigrations(database, ATLAS_MIGRATIONS);
    store = new WaitlistStore(sqliteWaitlistDatabase(database));
  });
  afterEach(() => database.close());

  it("deduplicates email and plan without overwriting private details", async () => {
    const first = await store.submit({
      email: "Person@Example.org",
      product: "atlas_pro",
      name: "First",
    });
    const duplicate = await store.submit({
      email: "person@example.org",
      product: "atlas_pro",
      name: "Injected",
    });
    expect(duplicate.id).toBe(first.id);
    expect(duplicate.name).toBe("First");
    expect(
      await store.submit({ email: "person@example.org", product: "atlas_team" }),
    ).not.toHaveProperty("id", first.id);
  });
  it("requires explicit confirmation before invitation and grants only the selected plan", async () => {
    const request = await store.submit({ email: "person@example.org", product: "atlas_pro" });
    await expect(store.invite(request.id, "staff")).rejects.toThrow("Confirm");
    const token = await store.createLink(request.id, "confirm");
    expect((await store.readLink(token, "confirm")).confirmedAt).toBeNull();
    await store.confirm(token);
    await store.invite(request.id, "staff");
    expect(await store.isAdmitted("person@example.org", "atlas_pro")).toBe(true);
    expect(await store.isAdmitted("other@example.org", "atlas_pro")).toBe(false);
    expect(await store.isAdmitted("person@example.org", "atlas_team")).toBe(false);
    await store.revoke(request.id, "staff");
    expect(await store.isAdmitted("person@example.org", "atlas_pro")).toBe(false);
    expect((await store.events(request.id)).map((event) => event.action)).toEqual([
      "submitted",
      "confirmed",
      "invited",
      "revoked",
    ]);
  });
  it("expires links without expiring purchase permission and isolates link scopes", async () => {
    const request = await store.submit({ email: "person@example.org", product: "atlas_team" });
    const confirm = await store.createLink(request.id, "confirm");
    await store.confirm(confirm);
    await store.invite(request.id, "staff");
    const manage = await store.createLink(request.id, "manage");
    await expect(store.readLink(manage, "confirm")).rejects.toThrow("expired");
    await expect(store.readLink("made-up", "manage")).rejects.toThrow("expired");
    vi.useFakeTimers();
    vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000);
    await expect(store.readLink(manage, "manage")).rejects.toThrow("expired");
    expect(await store.isAdmitted("person@example.org", "atlas_team")).toBe(true);
    vi.useRealTimers();
  });
  it("withdraws without deleting history and keeps approved plan separate from new requests", async () => {
    const request = await store.submit({ email: "person@example.org", product: "atlas_pro" });
    await store.confirm(await store.createLink(request.id, "confirm"));
    await store.invite(request.id, "staff");
    await store.update(request.id, {
      name: "Updated",
      organization: "Newsroom",
      intendedUse: "Reporting",
    });
    const team = await store.submit({ email: request.email, product: "atlas_team" });
    expect(team.status).toBe("unconfirmed");
    expect(await store.isAdmitted(request.email, "atlas_pro")).toBe(true);
    await store.withdraw(request.id);
    expect(await store.isAdmitted(request.email, "atlas_pro")).toBe(false);
    expect((await store.get(request.id)).name).toBe("Updated");
    expect((await store.events(request.id)).at(-1)?.action).toBe("withdrawn");
  });
  it("persists rate limits across store instances and rolls back failed transactions", async () => {
    await store.rateLimit("recipient", 1, 60_000);
    const second = new WaitlistStore(sqliteWaitlistDatabase(database));
    await expect(second.rateLimit("recipient", 1, 60_000)).rejects.toThrow("Try again");
    await expect(store.invite("missing", "staff")).rejects.toThrow();
    expect(await store.list()).toEqual([]);
  });
  it("rejects a billing interval from another product", async () => {
    await expect(
      store.submit({ email: "person@example.org", product: "atlas_team", interval: "weekly" }),
    ).rejects.toThrow();
    expect(await store.list()).toEqual([]);
  });
  it("keeps confirmation and invitation idempotent and rejects withdrawn or unconfirmed admission", async () => {
    const request = await store.submit({ email: "person@example.org", product: "atlas_pro" });
    await expect(store.rejoin(request.id)).rejects.toThrow("Confirm your email");
    const token = await store.createLink(request.id, "confirm");
    await store.confirm(token);
    await store.confirm(token);
    await store.invite(request.id, "staff");
    await store.invite(request.id, "staff");
    await store.withdraw(request.id);
    await store.withdraw(request.id);
    await expect(store.invite(request.id, "staff")).rejects.toThrow("not waiting");
    expect((await store.events(request.id)).map((event) => event.action)).toEqual([
      "submitted",
      "confirmed",
      "invited",
      "withdrawn",
    ]);
  });
  it("fails explicitly when the database cannot retain a request or rate limit", async () => {
    database.exec(
      "CREATE TRIGGER reject_request BEFORE INSERT ON waitlist_requests BEGIN SELECT RAISE(IGNORE); END;",
    );
    await expect(
      store.submit({ email: "person@example.org", product: "atlas_pro" }),
    ).rejects.toThrow("could not be saved");
    database.exec(
      "CREATE TRIGGER reject_rate BEFORE INSERT ON waitlist_rate_limits BEGIN SELECT RAISE(IGNORE); END;",
    );
    await expect(store.rateLimit("ip", 1, 60_000)).rejects.toThrow("Too many");
  });
  it.each([
    { product: "atlas_pro", interval: "four_month" },
    { product: "atlas_team", interval: "yearly" },
    { product: "atlas_research_pass", interval: "weekly" },
  ] as const)("retains valid $product billing context", async (selection) => {
    expect(await store.submit({ email: "person@example.org", ...selection })).toMatchObject(
      selection,
    );
  });
  it("can confirm a withdrawn request without reactivating it, then explicitly rejoin", async () => {
    const request = await store.submit({ email: "person@example.org", product: "atlas_pro" });
    const token = await store.createLink(request.id, "confirm");
    await store.withdraw(request.id);
    const confirmed = await store.confirm(token);
    expect(confirmed.status).toBe("withdrawn");
    expect(confirmed.confirmedAt).not.toBeNull();
    expect(await store.rejoin(request.id)).toMatchObject({ status: "waiting" });
  });
});
