import "@tanstack/react-start/server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { render } from "@react-email/render";
import { createElement } from "react";
import { UserFacingError } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import {
  EmailDeliveryRejected,
  type EmailMessage,
  type EmailService,
} from "@/platform/email/server/service";
import { WaitlistEmail, waitlistEmailCopy } from "@/platform/email/templates/waitlist-email";
import type { WaitlistDatabase } from "./database";
import type { WaitlistDelivery, WaitlistLinkKind, WaitlistRequest } from "../contracts";

interface DeliveryRow {
  id: string;
  request_id: string;
  kind: WaitlistLinkKind;
  status: WaitlistDelivery["status"];
  encrypted_message: string;
  provider_id: string | null;
  created_at: string;
  updated_at: string;
  attempts: number;
}
const map = (row: DeliveryRow): WaitlistDelivery => ({
  id: row.id,
  requestId: row.request_id,
  kind: row.kind,
  status: row.status,
  providerId: row.provider_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  attempts: row.attempts,
});

/** Durable per-recipient sends keep staff from mistaking approval for a successful email. */
export class WaitlistMailer {
  private readonly key: Buffer;
  constructor(
    private readonly database: WaitlistDatabase,
    private readonly email: EmailService,
    secret: string,
    private readonly baseUrl: string,
    private readonly timeoutMs = 10_000,
  ) {
    if (!secret) throw new Error("Waitlist email encryption requires the auth internal secret.");
    this.key = createHash("sha256").update(`atlas-waitlist-email:${secret}`).digest();
  }
  private encrypt(message: EmailMessage): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(message), "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
  }
  private decrypt(value: string): EmailMessage {
    const buffer = Buffer.from(value, "base64");
    const cipher = createDecipheriv("aes-256-gcm", this.key, buffer.subarray(0, 12));
    cipher.setAuthTag(buffer.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([cipher.update(buffer.subarray(28)), cipher.final()]).toString("utf8"),
    ) as EmailMessage;
  }
  async sendLink(
    request: WaitlistRequest,
    kind: WaitlistLinkKind,
    token: string,
    dedupeKey: string = randomUUID(),
  ): Promise<WaitlistDelivery> {
    const url = new URL("/waitlist/link", this.baseUrl);
    url.searchParams.set("token", token);
    url.searchParams.set("kind", kind);
    const copy = waitlistEmailCopy(kind, request.product);
    const message: EmailMessage = {
      to: request.email,
      subject: copy.subject,
      text: `${copy.title}\n\n${copy.body}\n\n${url}\n\nThis email link is valid for seven days. Request a fresh link at /waitlist.`,
      html: await render(
        createElement(WaitlistEmail, { kind, product: request.product, url: url.toString() }),
      ),
    };
    const id = randomUUID();
    const time = new Date().toISOString();
    const encryptedMessage = this.encrypt(message);
    const saved = await this.database.transaction(function* (db) {
      yield* db.query(
        `INSERT INTO waitlist_deliveries(id, request_id, kind, status, encrypted_message, dedupe_key, created_at, updated_at)
        VALUES (?, ?, ?, 'pending', ?, ?, ?, ?) ON CONFLICT(dedupe_key) DO NOTHING`,
        [id, request.id, kind, encryptedMessage, dedupeKey, time, time],
      );
      const [row] = yield* db.query<DeliveryRow>(
        "SELECT * FROM waitlist_deliveries WHERE dedupe_key = ?",
        [dedupeKey],
      );
      if (!row) throw new Error("Email could not be queued.");
      return row;
    });
    return this.retry(saved.id);
  }
  list(requestId: string): Promise<WaitlistDelivery[]> {
    return this.database.transaction(function* (db) {
      return (yield* db.query<DeliveryRow>(
        "SELECT * FROM waitlist_deliveries WHERE request_id = ? ORDER BY created_at DESC, id",
        [requestId],
      )).map(map);
    });
  }
  async retry(id: string): Promise<WaitlistDelivery> {
    const claimed = await this.database.transaction(function* (db) {
      const [row] = yield* db.query<DeliveryRow>(
        `SELECT * FROM waitlist_deliveries WHERE id = ?${db.lock}`,
        [id],
      );
      if (!row) throw new UserFacingError("This email is unavailable.");
      if (row.status === "sent") return { row, send: false };
      const elapsed = Date.now() - Date.parse(row.updated_at);
      if (row.status === "sending" && elapsed < 60_000) return { row, send: false };
      if (Date.now() - Date.parse(row.created_at) >= 23 * 3600_000)
        throw new UserFacingError(
          "This email needs an explicit resend. Retry is no longer available.",
        );
      yield* db.query(
        "UPDATE waitlist_deliveries SET status = 'sending', attempts = attempts + 1, updated_at = ? WHERE id = ?",
        [new Date().toISOString(), id],
      );
      return { row, send: true };
    });
    if (!claimed.send) return map(claimed.row);
    let providerId: string | null = null;
    let status: WaitlistDelivery["status"] = "unresolved";
    let uncertain = claimed.row.status === "unresolved" || claimed.row.status === "sending";
    try {
      const message = this.decrypt(claimed.row.encrypted_message);
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            providerId =
              (await Promise.race([
                this.email.send(message, { idempotencyKey: `waitlist/${id}` }),
                new Promise<never>((_, reject) => {
                  timer = setTimeout(() => {
                    reject(new Error("Email provider timed out."));
                  }, this.timeoutMs);
                }),
              ])) ?? null;
          } finally {
            clearTimeout(timer);
          }
          status = "sent";
          break;
        } catch (error) {
          if (!(error instanceof EmailDeliveryRejected)) uncertain = true;
          status = uncertain ? "unresolved" : "failed";
        }
      }
    } catch {
      status = uncertain ? "unresolved" : "failed";
    }
    return this.database.transaction(function* (db) {
      const [updated] = yield* db.query<DeliveryRow>(
        "UPDATE waitlist_deliveries SET status = ?, provider_id = ?, updated_at = ? WHERE id = ? AND status = 'sending' AND attempts = ? RETURNING *",
        [status, providerId, new Date().toISOString(), id, claimed.row.attempts + 1],
      );
      const current =
        updated ??
        (yield* db.query<DeliveryRow>("SELECT * FROM waitlist_deliveries WHERE id = ?", [id]))[0];
      if (!current) throw new Error("Email delivery record is unavailable.");
      return map(current);
    });
  }
}
