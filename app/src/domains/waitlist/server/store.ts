import "@tanstack/react-start/server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { UserFacingError } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import type {
  WaitlistDetails,
  WaitlistEvent,
  WaitlistLinkKind,
  WaitlistProduct,
  WaitlistRequest,
  WaitlistSignup,
} from "../contracts";
import { waitlistSignupSchema } from "../contracts";
import type { WaitlistConnection, WaitlistDatabase } from "./database";

interface RequestRow {
  id: string;
  email: string;
  product: WaitlistProduct;
  interval: string | null;
  name: string;
  organization: string;
  intended_use: string;
  status: WaitlistRequest["status"];
  created_at: string;
  confirmed_at: string | null;
  invited_at: string | null;
  purchased_at: string | null;
}
const now = () => new Date().toISOString();
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const map = (row: RequestRow): WaitlistRequest => ({
  id: row.id,
  email: row.email,
  product: row.product,
  interval: row.interval,
  name: row.name,
  organization: row.organization,
  intendedUse: row.intended_use,
  status: row.status,
  createdAt: row.created_at,
  confirmedAt: row.confirmed_at,
  invitedAt: row.invited_at,
  purchasedAt: row.purchased_at,
});
async function get(db: WaitlistConnection, id: string): Promise<WaitlistRequest> {
  const [row] = await db.query<RequestRow>(
    `SELECT * FROM waitlist_requests WHERE id = ?${db.lock}`,
    [id],
  );
  if (!row) throw new UserFacingError("This waitlist request is unavailable.");
  return map(row);
}
async function event(
  db: WaitlistConnection,
  requestId: string,
  action: string,
  actorId: string | null = null,
) {
  await db.query(
    "INSERT INTO waitlist_events(id, request_id, action, actor_id, created_at, row_number) SELECT ?, ?, ?, ?, ?, COALESCE(MAX(row_number), 0) + 1 FROM waitlist_events WHERE request_id = ?",
    [randomUUID(), requestId, action, actorId, now(), requestId],
  );
}
async function readLink(db: WaitlistConnection, token: string, kind: WaitlistLinkKind) {
  const [link] = await db.query<{ request_id: string }>(
    "SELECT request_id FROM waitlist_links WHERE digest = ? AND kind = ? AND expires_at > ?",
    [digest(token), kind, now()],
  );
  if (!link)
    throw new UserFacingError("This link has expired or is unavailable. Request a new email link.");
  return get(db, link.request_id);
}

/** Owns admission separately from payment so being invited never grants paid features. */
export class WaitlistStore {
  constructor(readonly database: WaitlistDatabase) {}
  async submit(input: WaitlistSignup): Promise<WaitlistRequest> {
    const data = waitlistSignupSchema.parse(input);
    return this.database.transaction(async (db) => {
      const id = randomUUID();
      const inserted = await db.query<RequestRow>(
        `INSERT INTO waitlist_requests
        (id, email, product, interval, name, organization, intended_use, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'unconfirmed', ?) ON CONFLICT(email, product) DO NOTHING RETURNING *`,
        [
          id,
          data.email,
          data.product,
          data.interval ?? null,
          data.name,
          data.organization,
          data.intendedUse,
          now(),
        ],
      );
      if (inserted[0]) {
        await event(db, id, "submitted");
        return map(inserted[0]);
      }
      const [existing] = await db.query<RequestRow>(
        "SELECT * FROM waitlist_requests WHERE email = ? AND product = ?",
        [data.email, data.product],
      );
      if (!existing) throw new Error("Waitlist request could not be saved.");
      return map(existing);
    });
  }
  get(id: string) {
    return this.database.transaction((db) => get(db, id));
  }
  list(email?: string): Promise<WaitlistRequest[]> {
    return this.database.transaction(async (db) =>
      (
        await db.query<RequestRow>(
          `SELECT * FROM waitlist_requests${email ? " WHERE email = ?" : ""} ORDER BY created_at, id`,
          email ? [email.toLowerCase()] : [],
        )
      ).map(map),
    );
  }
  async createLink(id: string, kind: WaitlistLinkKind): Promise<string> {
    return this.database.transaction(async (db) => {
      await get(db, id);
      const token = randomBytes(32).toString("base64url");
      await db.query("DELETE FROM waitlist_links WHERE expires_at <= ?", [now()]);
      await db.query(
        "INSERT INTO waitlist_links(digest, request_id, kind, expires_at) VALUES (?, ?, ?, ?)",
        [digest(token), id, kind, new Date(Date.now() + 7 * 86400_000).toISOString()],
      );
      return token;
    });
  }
  readLink(token: string, kind: WaitlistLinkKind) {
    return this.database.transaction((db) => readLink(db, token, kind));
  }
  async confirm(token: string): Promise<WaitlistRequest> {
    return this.database.transaction(async (db) => {
      const request = await readLink(db, token, "confirm");
      if (!request.confirmedAt) {
        await db.query("UPDATE waitlist_requests SET status = ?, confirmed_at = ? WHERE id = ?", [
          request.status === "unconfirmed" ? "waiting" : request.status,
          now(),
          request.id,
        ]);
        await event(db, request.id, "confirmed");
      }
      return get(db, request.id);
    });
  }
  async invite(id: string, actorId: string): Promise<WaitlistRequest> {
    return this.database.transaction(async (db) => {
      const request = await get(db, id);
      if (!request.confirmedAt) throw new UserFacingError("Confirm this email before inviting.");
      if (request.status !== "waiting" && request.status !== "invited")
        throw new UserFacingError("This request is not waiting for an invitation.");
      if (request.status !== "invited") {
        await db.query(
          "UPDATE waitlist_requests SET status = 'invited', invited_at = ? WHERE id = ?",
          [now(), id],
        );
        await event(db, id, "invited", actorId);
      }
      return get(db, id);
    });
  }
  async isAdmitted(email: string, product: WaitlistProduct): Promise<boolean> {
    return this.database.transaction(
      async (db) =>
        (
          await db.query(
            "SELECT id FROM waitlist_requests WHERE email = ? AND product = ? AND status = 'invited'",
            [email.toLowerCase(), product],
          )
        ).length > 0,
    );
  }
  async revoke(id: string, actorId: string) {
    return this.changeStatus(id, "revoked", actorId);
  }
  async withdraw(id: string) {
    return this.changeStatus(id, "withdrawn", null);
  }
  async rejoin(id: string) {
    return this.changeStatus(id, "waiting", null);
  }
  private async changeStatus(
    id: string,
    status: "revoked" | "withdrawn" | "waiting",
    actorId: string | null,
  ) {
    return this.database.transaction(async (db) => {
      const request = await get(db, id);
      if (status === "waiting" && !request.confirmedAt)
        throw new UserFacingError("Confirm your email first.");
      if (request.status !== status) {
        await db.query("UPDATE waitlist_requests SET status = ? WHERE id = ?", [status, id]);
        await event(db, id, status === "waiting" ? "rejoined" : status, actorId);
      }
      return get(db, id);
    });
  }
  async update(id: string, details: WaitlistDetails) {
    return this.database.transaction(async (db) => {
      await get(db, id);
      await db.query(
        "UPDATE waitlist_requests SET name = ?, organization = ?, intended_use = ? WHERE id = ?",
        [details.name, details.organization, details.intendedUse, id],
      );
      await event(db, id, "updated");
      return get(db, id);
    });
  }
  async markPurchased(email: string, product: WaitlistProduct) {
    return this.database.transaction(async (db) => {
      const [request] = await db.query<RequestRow>(
        "UPDATE waitlist_requests SET purchased_at = ? WHERE email = ? AND product = ? AND purchased_at IS NULL RETURNING *",
        [now(), email.toLowerCase(), product],
      );
      if (request) await event(db, request.id, "purchased");
    });
  }
  recordEvent(id: string, action: "email_retried" | "email_resent", actorId: string) {
    return this.database.transaction(async (db) => {
      await get(db, id);
      await event(db, id, action, actorId);
    });
  }
  events(id: string): Promise<WaitlistEvent[]> {
    return this.database.transaction(async (db) =>
      (
        await db.query<{
          id: string;
          request_id: string;
          action: string;
          actor_id: string | null;
          created_at: string;
        }>("SELECT * FROM waitlist_events WHERE request_id = ? ORDER BY created_at, row_number", [
          id,
        ])
      ).map((row) => ({
        id: row.id,
        requestId: row.request_id,
        action: row.action,
        actorId: row.actor_id,
        createdAt: row.created_at,
      })),
    );
  }
  async rateLimit(key: string, limit: number, duration: number) {
    return this.database.transaction(async (db) => {
      const hashed = digest(key);
      const start = new Date(Date.now() - duration).toISOString();
      await db.query("DELETE FROM waitlist_rate_limits WHERE started_at <= ?", [
        new Date(Date.now() - 86400_000).toISOString(),
      ]);
      const [record] = await db.query<{ count: number }>(
        `INSERT INTO waitlist_rate_limits(key, started_at, count) VALUES (?, ?, 1)
        ON CONFLICT(key) DO UPDATE SET count = CASE WHEN waitlist_rate_limits.started_at <= ? THEN 1 ELSE waitlist_rate_limits.count + 1 END,
        started_at = CASE WHEN waitlist_rate_limits.started_at <= ? THEN excluded.started_at ELSE waitlist_rate_limits.started_at END RETURNING count`,
        [hashed, now(), start, start],
      );
      if (!record || record.count > limit)
        throw new UserFacingError("Too many requests. Try again later.");
    });
  }
}
