# Atlas Discount & Specialty Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch three discount segments (independent journalists, grassroots nonprofits, civic tech workers) with verification, Stripe pricing, and admin dashboard.

**Architecture:** 
Discount strategy spans three layers: (1) **Signup** — capture segment eligibility, (2) **Verification** — validate claims via IRS lookup / portfolio / self-attestation, (3) **Billing** — apply discounted prices and track cohorts. All verification happens before checkout; metadata is stored in Better Auth organization object; admin dashboard monitors fraud/revenue.

**Tech Stack:** Stripe (pricing), TanStack Start (signup UI), Better Auth (org metadata), FastAPI (verification APIs), Tailwind CSS (UI).

---

## File Structure

**App (Frontend/Routing):**
- `app/src/domains/billing/discount-segments.ts` — Segment types and pricing constants
- `app/src/domains/billing/discount-pricing.ts` — Stripe price ID lookup by segment
- `app/src/domains/billing/verification/verification-form.tsx` — Unified verification form (routes to segment-specific flows)
- `app/src/domains/billing/verification/independent-journalist-form.tsx` — Portfolio submission
- `app/src/domains/billing/verification/grassroots-nonprofit-form.tsx` — EIN/budget form
- `app/src/domains/billing/verification/civic-tech-form.tsx` — GitHub/mission form
- `app/src/routes/auth/signup.tsx` — Modified signup to include discount eligibility question
- `app/src/routes/admin/discount-cohorts.tsx` — Admin dashboard for discount verification & monitoring
- `app/src/domains/access/server/discount-verification.server.ts` — Server functions for verification (IRS lookup, etc.)

**API (Backend):**
- `api/atlas/domains/access/irs_lookup.py` — IRS nonprofit database lookup
- `api/atlas/domains/access/verification.py` — Verification endpoints (submit, approve, deny, audit)
- `api/tests/domains/access/test_verification.py` — Verification logic tests

**Types/Schema:**
- `app/src/domains/access/organization-contracts.ts` — Organization metadata extension for `discount_segment`, `verification_status`, `verified_at`

**Migrations:**
- Better Auth will auto-extend org metadata (no explicit DB migration needed)

---

## Task Breakdown

### Task 1: Define Discount Segment Types & Constants

**Files:**
- Create: `app/src/domains/billing/discount-segments.ts`

- [ ] **Step 1: Write types and constants file**

```typescript
// app/src/domains/billing/discount-segments.ts

export type DiscountSegment = 
  | "independent_journalist"
  | "grassroots_nonprofit"
  | "civic_tech_worker";

export const DISCOUNT_SEGMENT_LABELS: Record<DiscountSegment, string> = {
  independent_journalist: "Independent Journalist",
  grassroots_nonprofit: "Grassroots Nonprofit (<$2M budget)",
  civic_tech_worker: "Civic Tech Worker",
};

export const DISCOUNT_PERCENTAGES: Record<DiscountSegment, number> = {
  independent_journalist: 0.5,  // 50% off
  grassroots_nonprofit: 0.4,    // 40% off
  civic_tech_worker: 0.5,       // 50% off
};

export const SEGMENT_DESCRIPTIONS: Record<DiscountSegment, string> = {
  independent_journalist: "Solo journalist or freelancer doing civic reporting",
  grassroots_nonprofit: "501(c)(3) nonprofit with annual budget under $2M doing frontline civic work",
  civic_tech_worker: "Building tools, infrastructure, or platforms for civic engagement and accountability",
};

export type VerificationStatus = "pending" | "verified" | "rejected" | "expired";
```

- [ ] **Step 2: Commit**

```bash
git add app/src/domains/billing/discount-segments.ts
git commit -m "feat(billing): Add discount segment types and constants"
```

---

### Task 2: Add Organization Metadata Extensions

**Files:**
- Modify: `app/src/domains/access/organization-contracts.ts`

- [ ] **Step 1: Read current organization metadata types**

Open `app/src/domains/access/organization-contracts.ts` and locate the `AtlasOrganizationMetadata` interface.

- [ ] **Step 2: Extend metadata with discount fields**

```typescript
// In AtlasOrganizationMetadata, add:

interface AtlasOrganizationMetadata {
  tier: "free" | "pro" | "team";
  ssoPrimaryProviderId: string | null;
  workspaceType: "individual" | "team";
  
  // Discount fields
  discountSegment?: "independent_journalist" | "grassroots_nonprofit" | "civic_tech_worker";
  verificationStatus?: "pending" | "verified" | "rejected" | "expired";
  verifiedAt?: string; // ISO timestamp
  verificationMethod?: "portfolio" | "irs_lookup" | "self_attestation"; // How they were verified
}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/domains/access/organization-contracts.ts
git commit -m "chore(access): Extend org metadata with discount verification fields"
```

---

### Task 3: Create Stripe Discount Price Objects

**Files:**
- Create: `app/src/domains/billing/discount-pricing.ts`
- Modify: `scripts/bootstrap/config/products.ts`

- [ ] **Step 1: Create discount pricing mapping**

```typescript
// app/src/domains/billing/discount-pricing.ts

import type { DiscountSegment } from "./discount-segments";

/**
 * Maps discount segments to environment variable keys for Stripe price IDs.
 * These are populated by the bootstrap script after creating prices in Stripe.
 */

export const DISCOUNT_PRICE_ENV_KEYS: Record<DiscountSegment, {
  proMonthly?: string;
  proYearly?: string;
  teamMonthly?: string;
  teamYearly?: string;
}> = {
  independent_journalist: {
    proMonthly: "STRIPE_PRICE_INDEPENDENT_JOURNALIST_PRO_MONTHLY",
    proYearly: "STRIPE_PRICE_INDEPENDENT_JOURNALIST_PRO_YEARLY",
    teamMonthly: "STRIPE_PRICE_INDEPENDENT_JOURNALIST_TEAM_MONTHLY",
    teamYearly: "STRIPE_PRICE_INDEPENDENT_JOURNALIST_TEAM_YEARLY",
  },
  grassroots_nonprofit: {
    teamMonthly: "STRIPE_PRICE_GRASSROOTS_NONPROFIT_TEAM_MONTHLY",
    teamYearly: "STRIPE_PRICE_GRASSROOTS_NONPROFIT_TEAM_YEARLY",
  },
  civic_tech_worker: {
    proMonthly: "STRIPE_PRICE_CIVIC_TECH_PRO_MONTHLY",
    proYearly: "STRIPE_PRICE_CIVIC_TECH_PRO_YEARLY",
    teamMonthly: "STRIPE_PRICE_CIVIC_TECH_TEAM_MONTHLY",
    teamYearly: "STRIPE_PRICE_CIVIC_TECH_TEAM_YEARLY",
  },
};

/**
 * Helper to get the correct Stripe price ID for a verified customer.
 */
export function getDiscountPriceId(
  segment: DiscountSegment,
  tier: "pro" | "team",
  interval: "monthly" | "yearly"
): string | null {
  const envKey = DISCOUNT_PRICE_ENV_KEYS[segment]?.[
    `${tier}${interval === "yearly" ? "Yearly" : "Monthly"}`
  ];
  
  if (!envKey) {
    return null; // Segment doesn't apply to this tier
  }
  
  return (process.env[envKey] ?? "").trim() || null;
}
```

- [ ] **Step 2: Update bootstrap script to create discount prices**

Open `scripts/bootstrap/config/products.ts` and add the discount products to the `ATLAS_PRODUCTS` array (before the closing bracket). Add all 5 discount products shown in the plan document.

- [ ] **Step 3: Verify products.ts syntax**

```bash
cd /Users/williecubed/Projects/RebuildingAmerica/atlas && npm run typecheck
```

Expected: No type errors in scripts/bootstrap/config/products.ts

- [ ] **Step 4: Commit**

```bash
git add app/src/domains/billing/discount-pricing.ts scripts/bootstrap/config/products.ts
git commit -m "feat(billing): Add discount price definitions and Stripe product configuration"
```

---

### Task 4: Create Verification Form Components (Frontend)

**Files:**
- Create: `app/src/domains/billing/verification/` directory and 4 form files

- [ ] **Step 1: Create directory**

```bash
mkdir -p app/src/domains/billing/verification
```

- [ ] **Step 2: Create independent journalist form**

Write the file at `app/src/domains/billing/verification/independent-journalist-form.tsx` with the code from the plan.

- [ ] **Step 3: Create grassroots nonprofit form**

Write the file at `app/src/domains/billing/verification/grassroots-nonprofit-form.tsx` with the code from the plan.

- [ ] **Step 4: Create civic tech form**

Write the file at `app/src/domains/billing/verification/civic-tech-form.tsx` with the code from the plan.

- [ ] **Step 5: Create unified verification form router**

Write the file at `app/src/domains/billing/verification/verification-form.tsx` with the code from the plan.

- [ ] **Step 6: Typecheck**

```bash
cd app && pnpm typecheck
```

Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add app/src/domains/billing/verification/
git commit -m "feat(billing): Add verification form components for discount segments"
```

---

### Task 5: Create Backend Verification API & IRS Lookup

**Files:**
- Create: `api/atlas/domains/access/irs_lookup.py`
- Create: `api/atlas/domains/access/verification.py`
- Create: `api/tests/domains/access/test_irs_lookup.py`

- [ ] **Step 1: Create test file for IRS lookup**

Write the test file at `api/tests/domains/access/test_irs_lookup.py` with the code from the plan (the test functions).

- [ ] **Step 2: Create IRS lookup implementation**

Write the file at `api/atlas/domains/access/irs_lookup.py` with the code from the plan (the actual lookup functions).

- [ ] **Step 3: Run IRS lookup tests**

```bash
cd /Users/williecubed/Projects/RebuildingAmerica/atlas/api
python -m pytest tests/domains/access/test_irs_lookup.py -v
```

Expected: All tests pass (or at least the structure is correct - some may fail if network access is unavailable).

- [ ] **Step 4: Create verification API**

Write the file at `api/atlas/domains/access/verification.py` with the code from the plan.

- [ ] **Step 5: Create verification endpoint tests**

Write the file at `api/tests/domains/access/test_verification.py` with the code from the plan (test functions).

- [ ] **Step 6: Run verification tests**

```bash
cd /Users/williecubed/Projects/RebuildingAmerica/atlas/api
python -m pytest tests/domains/access/test_verification.py -v
```

Expected: Tests are runnable (may have fixtures missing, but syntax should be correct).

- [ ] **Step 7: Commit**

```bash
git add api/atlas/domains/access/irs_lookup.py api/atlas/domains/access/verification.py api/tests/domains/access/test_irs_lookup.py api/tests/domains/access/test_verification.py
git commit -m "feat(access): Add verification API with IRS nonprofit lookup"
```

---

### Task 6: Integrate Verification into Signup Flow

**Files:**
- Modify: `app/src/routes/auth/signup.tsx`

- [ ] **Step 1: Read current signup**

```bash
head -100 app/src/routes/auth/signup.tsx
```

Review the structure to understand where to add discount segment selection.

- [ ] **Step 2: Add imports at top**

Add these imports:

```typescript
import { useState } from "react";
import type { DiscountSegment } from "../../domains/billing/discount-segments";
import { SEGMENT_DESCRIPTIONS } from "../../domains/billing/discount-segments";
```

- [ ] **Step 3: Add state for discount segment**

In the SignupPage component, add after existing state:

```typescript
const [selectedSegment, setSelectedSegment] = useState<DiscountSegment | "">("");
```

- [ ] **Step 4: Add segment selection UI in form**

Add this UI block after password fields and before the submit button:

```typescript
<div className="space-y-3">
  <label className="block text-sm font-medium text-ink-strong">
    Do you qualify for a nonprofit or special pricing discount?
  </label>
  <select
    value={selectedSegment}
    onChange={(e) => setSelectedSegment(e.target.value as DiscountSegment | "")}
    className="w-full px-3 py-2 border border-border rounded-lg"
  >
    <option value="">No, I'll pay full price</option>
    <option value="independent_journalist">
      Independent Journalist
    </option>
    <option value="grassroots_nonprofit">
      Grassroots Nonprofit (&lt;$2M budget)
    </option>
    <option value="civic_tech_worker">
      Civic Tech Worker
    </option>
  </select>
  
  {selectedSegment && (
    <p className="text-xs text-ink-soft">
      {SEGMENT_DESCRIPTIONS[selectedSegment as DiscountSegment]}
    </p>
  )}
</div>
```

- [ ] **Step 5: Update signup success handler**

In the signup success callback, replace the standard redirect with:

```typescript
if (selectedSegment) {
  void navigate({
    to: "/verify-discount",
    search: { segment: selectedSegment },
  });
} else {
  void navigate({ to: "/discovery" });
}
```

- [ ] **Step 6: Typecheck**

```bash
cd app && pnpm typecheck
```

Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add app/src/routes/auth/signup.tsx
git commit -m "feat(auth): Add discount segment selection to signup"
```

---

### Task 7: Create Discount Verification Page

**Files:**
- Create: `app/src/routes/verify-discount.tsx`
- Create: `app/src/routes/verify-discount.server.ts`

- [ ] **Step 1: Create verification page**

Write the file at `app/src/routes/verify-discount.tsx` with the code from the plan.

- [ ] **Step 2: Create server functions**

Write the file at `app/src/routes/verify-discount.server.ts` with the code from the plan.

- [ ] **Step 3: Add route to router**

In `app/src/routeTree.gen.ts` or your route configuration, add the verify-discount route. (Check current route structure first.)

- [ ] **Step 4: Typecheck**

```bash
cd app && pnpm typecheck
```

Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add app/src/routes/verify-discount.tsx app/src/routes/verify-discount.server.ts
git commit -m "feat(auth): Add discount verification page with segment-specific forms"
```

---

### Task 8: Create Admin Dashboard for Discount Management

**Files:**
- Create: `app/src/routes/admin/discount-cohorts.tsx`

- [ ] **Step 1: Create admin directory if needed**

```bash
mkdir -p app/src/routes/admin
```

- [ ] **Step 2: Create discount cohorts admin page**

Write the file at `app/src/routes/admin/discount-cohorts.tsx` with the code from the plan.

- [ ] **Step 3: Add route to router**

In your route configuration, add the `/admin/discount-cohorts` route.

- [ ] **Step 4: Typecheck**

```bash
cd app && pnpm typecheck
```

Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add app/src/routes/admin/discount-cohorts.tsx
git commit -m "feat(admin): Add discount cohorts dashboard"
```

---

### Task 9: Wire Discounts into Checkout Flow

**Files:**
- Modify: `app/src/domains/billing/checkout.functions.ts`

- [ ] **Step 1: Read current checkout**

```bash
head -150 app/src/domains/billing/checkout.functions.ts
```

Understand how prices are selected.

- [ ] **Step 2: Add import**

Add at the top:

```typescript
import { getDiscountPriceId } from "./discount-pricing";
```

- [ ] **Step 3: Modify getPriceId or equivalent function**

Find where price IDs are looked up and modify to check for discount first (code in plan).

- [ ] **Step 4: Typecheck**

```bash
cd app && pnpm typecheck
```

Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add app/src/domains/billing/checkout.functions.ts
git commit -m "feat(billing): Apply verified discounts at checkout"
```

---

### Task 10: Update Pricing Page to Link to Discount Info

**Files:**
- Modify: `app/src/domains/billing/pages/pricing-page.tsx`

- [ ] **Step 1: Read pricing page**

```bash
head -50 app/src/domains/billing/pages/pricing-page.tsx
```

- [ ] **Step 2: Add discount callout**

After the lede section and before the plan grid, add the callout (code in plan).

- [ ] **Step 3: Typecheck**

```bash
cd app && pnpm typecheck
```

Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add app/src/domains/billing/pages/pricing-page.tsx
git commit -m "feat(billing): Add discount callout to pricing page"
```

---

## Testing Checklist

- [ ] Verify signup form includes discount segment dropdown
- [ ] Verify segment-specific forms work (journalist portfolio, nonprofit EIN, civic tech GitHub)
- [ ] Verify IRS lookup finds real nonprofits (EFF: 04-1798922)
- [ ] Verify discounted prices apply at checkout for verified users
- [ ] Verify standard prices apply for unverified users
- [ ] Verify admin dashboard loads

---

**End of plan.**
