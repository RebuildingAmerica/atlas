import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { mergeEnvFile, parseEnvFile } from "./env-file.js";

void describe("env file helpers", () => {
  void it("round-trips generated JSON env values", () => {
    const root = mkdtempSync(path.join(tmpdir(), "atlas-env-file-"));
    const envFile = path.join(root, ".env");
    const catalog = JSON.stringify({
      coupons: { student: "coupon_student" },
      prices: { "pro-monthly": "price_pro_monthly" },
      products: { pro: "prod_pro" },
    });

    try {
      mergeEnvFile(envFile, new Map([["STRIPE_ATLAS_CATALOG", catalog]]));

      assert.equal(parseEnvFile(envFile).get("STRIPE_ATLAS_CATALOG"), catalog);
    } finally {
      rmSync(root, { recursive: true });
    }
  });
});
