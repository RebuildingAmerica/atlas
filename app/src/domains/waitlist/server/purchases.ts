import "@tanstack/react-start/server-only";
import { getWaitlistStore, isManagedWaitlist } from "./runtime";
import { waitlistProductSchema } from "../contracts";

/** Records completed signup only after billing has recorded settled payment. */
export async function recordWaitlistPurchase(purchaseId: string): Promise<void> {
  if (!isManagedWaitlist()) return;
  const store = await getWaitlistStore();
  const buyer = await store.database.transaction(async (db) => {
    const [row] = await db.query<{ email: string; product: string }>(
      `SELECT u.email, p.product FROM purchase_intents p INNER JOIN "user" u ON u.id = p.user_id WHERE p.id = ? AND p.status = 'paid'`,
      [purchaseId],
    );
    return row;
  });
  if (buyer) await store.markPurchased(buyer.email, waitlistProductSchema.parse(buyer.product));
}
