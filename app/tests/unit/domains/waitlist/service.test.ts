import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATLAS_MIGRATIONS,
  runAtlasCustomMigrations,
} from "@/domains/access/server/atlas-migrations";
import { WaitlistStore } from "@/domains/waitlist/server/store";
import { sqliteWaitlistDatabase } from "@/domains/waitlist/server/database";
import { createAtlasSessionFixture } from "../../../fixtures/access/sessions";
import * as functions from "@/domains/waitlist/waitlist.functions";
import { handlePlatformWaitlistRequest } from "@/domains/waitlist/server/internal-platform-waitlist";
import { requireWaitlistStaff } from "@/domains/waitlist/server/runtime";
import { recordWaitlistPurchase } from "@/domains/waitlist/server/purchases";
import { markPurchaseIntentPaid } from "@/domains/billing/server/purchase-intents";
const mocks = vi.hoisted(() => ({
  database: vi.fn(),
  session: vi.fn(),
  readySession: vi.fn(),
  fetch: vi.fn(),
  availability: vi.fn(),
  request: vi.fn(),
}));
vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@tanstack/react-start/server", () => ({ setResponseHeader: vi.fn() }));
vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("../../../helpers/server-fn-stub")).createServerFnStub(),
}));
vi.mock("@/domains/access/server/auth", () => ({
  ensureAuthReady: () => Promise.resolve({}),
  getAuthDatabase: mocks.database,
  getAuthPgPool: () => null,
}));
vi.mock("@/domains/access/server/auth-db", () => ({
  getAuthDatabase: mocks.database,
  getAuthPgPool: () => null,
}));
vi.mock("@/domains/access/server/session-state", () => ({
  loadAtlasSession: mocks.session,
  requireReadyAtlasSessionState: mocks.readySession,
}));
vi.mock("@/domains/access/server/request-headers", () => ({
  getServerFnRequest: mocks.request,
}));
vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: () => ({
    anonymousRateLimit: { trustedProxyHops: 1 },
    callbackSecret: "callback-test-secret", // pragma: allowlist secret - test fixture
    instanceOperatorEmails: new Set(["staff@example.org"]),
    emailProvider: "capture",
    emailFrom: "Atlas <hello@atlas.test>",
    captureUrl: "https://capture.test/messages",
    internalSecret: "waitlist-test-secret", // pragma: allowlist secret - test fixture
    publicBaseUrl: "https://atlas.test",
  }),
}));
vi.mock("@/domains/billing/server/checkout-availability", () => ({
  resolveCheckoutAvailability: mocks.availability,
}));

describe("waitlist server contracts", () => {
  async function callback(
    body: object,
    secret = "callback-test-secret", // pragma: allowlist secret - test fixture
  ) {
    return handlePlatformWaitlistRequest(
      new Request("https://atlas.test/api/auth/internal/platform-waitlist", {
        method: "POST",
        headers: { "X-Atlas-Callback-Secret": secret, "Content-Type": "application/json" },
        body: JSON.stringify({ operatorEmail: "platform@example.org", ...body }),
      }),
    );
  }
  async function operation<T>(body: object): Promise<T> {
    const response = await callback(body);
    if (!response.ok) throw new Error(((await response.json()) as { error: string }).error);
    return response.json() as Promise<T>;
  }
  const platformFunctions = {
    listWaitlistRequests: () =>
      operation<Awaited<ReturnType<typeof functions.listWaitlistRequests>>>({ operation: "list" }),
    loadWaitlistStaffDetail: ({ data }: { data: { id: string } }) =>
      operation<Awaited<ReturnType<typeof functions.loadWaitlistStaffDetail>>>({
        operation: "detail",
        ...data,
      }),
    inviteWaitlistRequests: ({ data }: { data: { ids: string[] } }) =>
      operation<Awaited<ReturnType<typeof functions.inviteWaitlistRequests>>>({
        operation: "invite",
        ...data,
      }),
    actOnWaitlistRequest: ({ data }: { data: functions.StaffWaitlistAction }) =>
      operation<Awaited<ReturnType<typeof functions.actOnWaitlistRequest>>>({
        operation: "action",
        ...data,
      }),
  };

  function required<T>(value: T | undefined): T {
    if (value === undefined) throw new Error("Expected test record");
    return value;
  }
  let db: Database.Database;
  let store: WaitlistStore;
  beforeEach(() => {
    mocks.request.mockReturnValue(
      new Request("https://atlas.test/_serverFn", { headers: { "x-forwarded-for": "192.0.2.1" } }),
    );
    db = new Database(":memory:");
    runAtlasCustomMigrations(db, ATLAS_MIGRATIONS);
    db.exec('CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT NOT NULL)');
    store = new WaitlistStore(sqliteWaitlistDatabase(db));
    mocks.database.mockReturnValue(db);
    mocks.session.mockResolvedValue(null);
    mocks.readySession.mockResolvedValue(
      createAtlasSessionFixture({ user: { email: "staff@example.org" } }),
    );
    mocks.availability.mockResolvedValue({
      available: true,
      allowedOffers: ["atlas_pro:monthly", "atlas_team:yearly"],
    });
    mocks.fetch.mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", mocks.fetch);
    vi.stubEnv("ATLAS_MANAGED", "true");
    vi.stubEnv("ATLAS_MULTI_USER", "true");
    vi.stubEnv("ATLAS_PAID_ACCESS_MODE", "waitlist");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("rejects forged callbacks, unlisted operations and browser-supplied actor fields", async () => {
    expect((await callback({ operation: "list" }, "forged")).status).toBe(401);
    for (const body of [
      { operation: "delete" },
      { operation: "invite", ids: [] },
      { operation: "invite", ids: Array.from({ length: 51 }, () => "request") },
      { operation: "list", actorId: "forged" },
      { operation: "action", id: "request", action: "retry" },
      { operation: "list", operatorEmail: "" },
    ])
      expect((await callback(body)).status).toBe(400);
    vi.stubEnv("ATLAS_MANAGED", "false");
    expect((await callback({ operation: "list" })).status).toBe(404);
  });
  it("rejects malformed JSON and exposes storage failures rather than false empty queues", async () => {
    const malformed = await handlePlatformWaitlistRequest(
      new Request("https://atlas.test/api/auth/internal/platform-waitlist", {
        method: "POST",
        headers: { "X-Atlas-Callback-Secret": "callback-test-secret" }, // pragma: allowlist secret - test fixture
        body: "not json",
      }),
    );
    expect(malformed.status).toBe(400);
    vi.spyOn(WaitlistStore.prototype, "list").mockRejectedValueOnce(new Error("Database offline"));
    await expect(callback({ operation: "list" })).rejects.toThrow("Database offline");
  });
  it("saves anonymous signup and confirms only after an explicit action", async () => {
    await expect(
      functions.submitWaitlist({ data: { email: "Person@example.org", product: "atlas_pro" } }),
    ).resolves.toEqual({ status: "confirmation_pending" });
    const [request] = await store.list();
    expect(request?.status).toBe("unconfirmed");
    const capture = JSON.parse(
      String((mocks.fetch.mock.calls[0]?.[1] as { body: string } | undefined)?.body),
    ) as { text: string };
    const url = new URL(/https:\/\/\S+/.exec(capture.text)?.[0] ?? "");
    const token = url.searchParams.get("token") ?? "";
    await functions.loadWaitlistLink({ data: { token, kind: "confirm" } });
    expect((await store.get(required(request).id)).status).toBe("unconfirmed");
    await functions.confirmWaitlist({ data: { token } });
    expect((await store.get(required(request).id)).status).toBe("waiting");
    await expect(
      functions.submitWaitlist({ data: { email: "person@example.org", product: "atlas_pro" } }),
    ).rejects.toThrow("Try again");
  });
  it("distinguishes unavailable email links from temporary storage failures", async () => {
    await expect(
      functions.loadWaitlistLink({ data: { token: "expired", kind: "invite" } }),
    ).resolves.toBeNull();
    const request = await store.submit({ email: "person@example.org", product: "atlas_pro" });
    const token = await store.createLink(request.id, "invite");
    db.exec("UPDATE waitlist_links SET expires_at = '2000-01-01'");
    await expect(
      functions.loadWaitlistLink({ data: { token, kind: "invite" } }),
    ).resolves.toBeNull();
    vi.spyOn(WaitlistStore.prototype, "readLink").mockRejectedValueOnce(
      new Error("Database offline"),
    );
    await expect(functions.loadWaitlistLink({ data: { token, kind: "invite" } })).rejects.toThrow(
      "Database offline",
    );
  });
  it("gives bots the same receipt without sending mail and retains signup on email failure", async () => {
    await expect(
      functions.submitWaitlist({
        data: { email: "bot@example.org", product: "atlas_pro", website: "spam" },
      }),
    ).resolves.toEqual({ status: "confirmation_pending" });
    expect(await store.list()).toEqual([]);
    mocks.fetch.mockRejectedValue(new TypeError("offline"));
    await expect(
      functions.submitWaitlist({ data: { email: "person@example.org", product: "atlas_pro" } }),
    ).rejects.toThrow("saved");
    expect(await store.list()).toHaveLength(1);
  });
  it("rejects private access from another account and permits scoped email links", async () => {
    const request = await store.submit({ email: "person@example.org", product: "atlas_pro" });
    const token = await store.createLink(request.id, "confirm");
    await expect(
      functions.loadWaitlistRequest({ data: { id: request.id, token, kind: "confirm" } }),
    ).rejects.toThrow("Sign in");
    await store.confirm(token);
    expect(
      await functions.loadWaitlistRequest({ data: { id: request.id, token, kind: "confirm" } }),
    ).toMatchObject({ email: request.email });
    mocks.session.mockResolvedValue(
      createAtlasSessionFixture({ user: { email: "other@example.org" } }),
    );
    await expect(functions.loadWaitlistRequest({ data: { id: request.id } })).rejects.toThrow(
      "Sign in",
    );
    mocks.session.mockResolvedValue(createAtlasSessionFixture({ user: { email: request.email } }));
    await expect(
      functions.loadWaitlistRequest({ data: { id: request.id } }),
    ).resolves.toMatchObject({ id: request.id });
    await functions.updateWaitlistRequest({
      data: {
        id: request.id,
        details: { name: "New", organization: "Newsroom", intendedUse: "Research" },
      },
    });
    expect((await store.get(request.id)).name).toBe("New");
    await functions.changeWaitlistRequest({ data: { id: request.id, action: "withdraw" } });
    expect((await store.get(request.id)).status).toBe("withdrawn");
    await functions.changeWaitlistRequest({ data: { id: request.id, action: "rejoin" } });
    expect((await store.get(request.id)).status).toBe("waiting");
  });
  it("refuses every app session including instance operators on staff endpoints", async () => {
    for (const session of [
      createAtlasSessionFixture({ user: { email: "customer@example.org" } }),
      createAtlasSessionFixture({ user: { email: "staff@example.org" } }),
    ]) {
      mocks.readySession.mockResolvedValue(session);
      await expect(functions.listWaitlistRequests()).rejects.toThrow("platform admin");
      await expect(functions.loadWaitlistStaffAccess()).rejects.toThrow("platform admin");
      await expect(requireWaitlistStaff()).rejects.toThrow("platform admin");
      await expect(functions.loadWaitlistStaffDetail({ data: { id: "request" } })).rejects.toThrow(
        "platform admin",
      );
      await expect(
        functions.inviteWaitlistRequests({ data: { ids: ["request"] } }),
      ).rejects.toThrow("platform admin");
      await expect(
        functions.actOnWaitlistRequest({ data: { id: "request", action: "revoke" } }),
      ).rejects.toThrow("platform admin");
    }
  });
  it("invites selected confirmed requests, reports partial failure, and records resend and revocation", async () => {
    const request = await store.submit({ email: "person@example.org", product: "atlas_pro" });
    await store.confirm(await store.createLink(request.id, "confirm"));
    const result = await platformFunctions.inviteWaitlistRequests({
      data: { ids: [request.id, "missing", request.id] },
    });
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({ id: request.id, status: "sent" });
    expect(result.results[1]).toMatchObject({ id: "missing", status: "failed" });
    const list = await platformFunctions.listWaitlistRequests();
    expect(list.records[0]?.deliveries[0]?.status).toBe("sent");
    const detail = await platformFunctions.loadWaitlistStaffDetail({ data: { id: request.id } });
    expect(detail.events).toContainEqual(
      expect.objectContaining({ action: "invited", actorId: "platform@example.org" }),
    );
    await platformFunctions.actOnWaitlistRequest({ data: { id: request.id, action: "resend" } });
    await expect(
      platformFunctions.actOnWaitlistRequest({
        data: { id: request.id, action: "retry", deliveryId: "unrelated" },
      }),
    ).rejects.toThrow("unavailable");
    await platformFunctions.actOnWaitlistRequest({
      data: {
        id: request.id,
        action: "retry",
        deliveryId: required(detail.deliveries.find((delivery) => delivery.kind === "invite")).id,
      },
    });
    await platformFunctions.actOnWaitlistRequest({ data: { id: request.id, action: "revoke" } });
    expect(await store.isAdmitted(request.email, request.product)).toBe(false);
    await expect(
      platformFunctions.actOnWaitlistRequest({ data: { id: request.id, action: "resend" } }),
    ).rejects.toThrow("no active invitation");
  });
  it("blocks invitations during a sales pause but keeps signup available", async () => {
    const request = await store.submit({
      email: "person@example.org",
      product: "atlas_research_pass",
    });
    await store.confirm(await store.createLink(request.id, "confirm"));
    expect(
      (await platformFunctions.inviteWaitlistRequests({ data: { ids: [request.id] } })).results[0]
        ?.message,
    ).toContain("paused");
    mocks.availability.mockResolvedValue({ available: false, allowedOffers: [] });
    expect(
      (await platformFunctions.inviteWaitlistRequests({ data: { ids: [request.id] } })).results[0]
        ?.status,
    ).toBe("failed");
    await expect(
      functions.submitWaitlist({ data: { email: "new@example.org", product: "atlas_team" } }),
    ).resolves.toHaveProperty("status", "confirmation_pending");
  });
  it("keeps email send failure separate from granted permission", async () => {
    const request = await store.submit({ email: "person@example.org", product: "atlas_pro" });
    await store.confirm(await store.createLink(request.id, "confirm"));
    mocks.fetch.mockRejectedValue(new TypeError("offline"));
    expect(
      (await platformFunctions.inviteWaitlistRequests({ data: { ids: [request.id] } })).results[0]
        ?.status,
    ).toBe("unresolved");
    expect(await store.isAdmitted(request.email, request.product)).toBe(true);
  });
  it("returns only the verified viewer’s requests and records only settled purchases", async () => {
    const request = await store.submit({ email: "person@example.org", product: "atlas_pro" });
    await store.confirm(await store.createLink(request.id, "confirm"));
    await store.invite(request.id, "staff");
    expect((await functions.loadPaidAccess()).requests).toEqual([]);
    mocks.session.mockResolvedValue(createAtlasSessionFixture({ user: { email: request.email } }));
    expect((await functions.loadPaidAccess()).admittedProducts).toEqual(["atlas_pro"]);
    db.prepare('INSERT INTO "user" (id, email) VALUES (?, ?)').run("buyer", request.email);
    db.prepare(
      "INSERT INTO purchase_intents (id,user_id,product,interval,status,created_at,updated_at,expires_at) VALUES ('purchase','buyer','atlas_pro','monthly','checkout_created','now','now','later')",
    ).run();
    await recordWaitlistPurchase("purchase");
    expect((await store.get(request.id)).purchasedAt).toBeNull();
    db.prepare(
      "UPDATE purchase_intents SET workspace_id = 'workspace', stripe_checkout_session_id = 'session' WHERE id = 'purchase'",
    ).run();
    await store.revoke(request.id, "staff");
    await markPurchaseIntentPaid({
      id: "purchase",
      product: "atlas_pro",
      workspaceId: "workspace",
      stripeCheckoutSessionId: "session",
    });
    await recordWaitlistPurchase("purchase");
    expect((await store.get(request.id)).purchasedAt).not.toBeNull();
    expect(
      (await store.events(request.id)).filter((event) => event.action === "purchased"),
    ).toHaveLength(1);
    vi.stubEnv("ATLAS_MANAGED", "false");
    expect((await functions.loadPaidAccess()).mode).toBe("unavailable");
    await expect(
      functions.submitWaitlist({ data: { email: "new@example.org", product: "atlas_pro" } }),
    ).rejects.toThrow("unavailable on this instance");
    await expect(functions.listWaitlistRequests()).rejects.toThrow("platform admin");
    await recordWaitlistPurchase("purchase");
  });
  it("rejects browser execution and a mismatched scoped request", async () => {
    vi.stubEnv("SSR", false);
    await expect(functions.loadPaidAccess()).rejects.toThrow("require the server");
    vi.stubEnv("SSR", true);
    const first = await store.submit({ email: "one@example.org", product: "atlas_pro" });
    const second = await store.submit({ email: "two@example.org", product: "atlas_pro" });
    const token = await store.createLink(first.id, "manage");
    await expect(
      functions.loadWaitlistRequest({ data: { id: second.id, token, kind: "manage" } }),
    ).rejects.toThrow("Sign in");
    await expect(
      functions.loadWaitlistRequest({ data: { id: first.id, token, kind: "manage" } }),
    ).resolves.toMatchObject({ id: first.id });
  });
  it("sends a private management link for confirmed duplicate signup and audits mail actions", async () => {
    const request = await store.submit({ email: "person@example.org", product: "atlas_pro" });
    await store.confirm(await store.createLink(request.id, "confirm"));
    await functions.submitWaitlist({ data: { email: request.email, product: request.product } });
    const capture = JSON.parse(
      String((mocks.fetch.mock.calls[0]?.[1] as { body: string } | undefined)?.body),
    ) as { text: string };
    expect(capture.text).toContain("kind=manage");
    await store.invite(request.id, "staff");
    await platformFunctions.actOnWaitlistRequest({ data: { id: request.id, action: "resend" } });
    const detail = await platformFunctions.loadWaitlistStaffDetail({ data: { id: request.id } });
    await platformFunctions.actOnWaitlistRequest({
      data: { id: request.id, action: "retry", deliveryId: required(detail.deliveries[0]).id },
    });
    expect(
      (await store.events(request.id))
        .filter((event) => event.action.startsWith("email_"))
        .map((event) => event.actorId),
    ).toEqual([expect.any(String), expect.any(String)]);
  });

  it("rate limits requests without a client IP and reports provider readiness failures per applicant", async () => {
    mocks.request.mockReturnValue(new Request("https://atlas.test/_serverFn"));
    await functions.submitWaitlist({ data: { email: "person@example.org", product: "atlas_pro" } });
    const [request] = await store.list();
    await store.confirm(await store.createLink(required(request).id, "confirm"));
    mocks.availability.mockRejectedValueOnce(new Error("provider unavailable"));
    expect(
      (await platformFunctions.inviteWaitlistRequests({ data: { ids: [required(request).id] } }))
        .results[0]?.message,
    ).toBe("This invitation could not be sent.");
  });
  it("starts a bounded group of recipient sends instead of serializing a slow batch", async () => {
    const ids: string[] = [];
    for (let index = 0; index < 12; index++) {
      const request = await store.submit({
        email: `batch-${index}@example.org`,
        product: "atlas_pro",
      });
      await store.confirm(await store.createLink(request.id, "confirm"));
      ids.push(request.id);
    }
    let release: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    mocks.fetch.mockReturnValue(pending);
    const batch = platformFunctions.inviteWaitlistRequests({ data: { ids } });
    try {
      await vi.waitFor(() => {
        expect(mocks.fetch).toHaveBeenCalledTimes(10);
      });
    } finally {
      if (release) release(new Response("{}"));
      await batch;
    }
    expect((await batch).results).toHaveLength(12);
  });
  it("lets the matching verified applicant explicitly confirm a private unconfirmed request", async () => {
    const request = await store.submit({ email: "person@example.org", product: "atlas_pro" });
    mocks.session.mockResolvedValue(createAtlasSessionFixture({ user: { email: request.email } }));
    expect(
      await functions.changeWaitlistRequest({ data: { id: request.id, action: "confirm" } }),
    ).toMatchObject({ status: "waiting" });
  });
});
