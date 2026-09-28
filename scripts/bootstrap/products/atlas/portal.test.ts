import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type Stripe from "stripe";
import { ensureBillingPortalConfiguration } from "./portal.js";

function configuration(id: string, metadata: Record<string, string> = {}) {
  return { id, metadata, active: true, livemode: true };
}

void describe("Atlas billing portal bootstrap", () => {
  void it("creates an Atlas-specific portal with customer exit controls", async () => {
    const calls: { method: string; params: unknown }[] = [];
    const stripe = {
      billingPortal: {
        configurations: {
          list: () => Promise.resolve({ data: [], has_more: false }),
          create: (params: unknown) => {
            calls.push({ method: "create", params });
            return Promise.resolve(
              configuration("bpc_atlas", { atlas_portal: "billing" }),
            );
          },
        },
      },
    } as unknown as Stripe;

    const result = await ensureBillingPortalConfiguration(
      stripe,
      "https://atlas.rebuildingus.org",
    );

    assert.equal(result.id, "bpc_atlas");
    assert.deepEqual(calls, [
      {
        method: "create",
        params: {
          name: "Atlas billing",
          business_profile: {
            privacy_policy_url: "https://atlas.rebuildingus.org/privacy",
            terms_of_service_url: "https://atlas.rebuildingus.org/terms",
          },
          features: {
            customer_update: { enabled: false },
            invoice_history: { enabled: true },
            payment_method_update: { enabled: true },
            subscription_cancel: { enabled: true, mode: "at_period_end" },
            subscription_update: { enabled: false },
          },
          metadata: {
            atlas_portal: "billing",
            atlas_origin: "https://atlas.rebuildingus.org",
          },
        },
      },
    ]);
  });

  void it("updates the configured Atlas portal instead of creating another", async () => {
    const calls: string[] = [];
    const stripe = {
      billingPortal: {
        configurations: {
          retrieve: (id: string) => {
            calls.push(`retrieve:${id}`);
            return Promise.resolve(
              configuration(id, {
                atlas_portal: "billing",
                atlas_origin: "https://atlas.rebuildingus.org",
              }),
            );
          },
          update: (id: string) => {
            calls.push(`update:${id}`);
            return Promise.resolve(
              configuration(id, {
                atlas_portal: "billing",
                atlas_origin: "https://atlas.rebuildingus.org",
              }),
            );
          },
          create: () =>
            Promise.reject(new Error("must not create duplicate portal")),
        },
      },
    } as unknown as Stripe;

    const result = await ensureBillingPortalConfiguration(
      stripe,
      "https://atlas.rebuildingus.org",
      "bpc_atlas",
    );

    assert.equal(result.id, "bpc_atlas");
    assert.deepEqual(calls, ["retrieve:bpc_atlas", "update:bpc_atlas"]);
    await assert.rejects(
      ensureBillingPortalConfiguration(
        stripe,
        "https://atlas-staging.rebuildingus.org",
        "bpc_atlas",
      ),
      /does not belong to this Atlas origin/,
    );
  });

  void it("reuses one tagged portal and refuses ambiguous tagged portals", async () => {
    const tagged = configuration("bpc_atlas", {
      atlas_portal: "billing",
      atlas_origin: "https://atlas.rebuildingus.org",
    });
    const other = configuration("bpc_other", {
      atlas_portal: "billing",
      atlas_origin: "https://atlas-staging.rebuildingus.org",
    });
    let listed = [other, tagged];
    const stripe = {
      billingPortal: {
        configurations: {
          list: () => Promise.resolve({ data: listed, has_more: false }),
          update: (id: string) =>
            Promise.resolve(configuration(id, tagged.metadata)),
        },
      },
    } as unknown as Stripe;

    const result = await ensureBillingPortalConfiguration(
      stripe,
      "https://atlas.rebuildingus.org",
    );
    assert.equal(result.id, "bpc_atlas");

    listed = [tagged, configuration("bpc_duplicate", tagged.metadata)];
    await assert.rejects(
      ensureBillingPortalConfiguration(
        stripe,
        "https://atlas.rebuildingus.org",
      ),
      /Multiple Atlas billing portal configurations/,
    );
  });
});
