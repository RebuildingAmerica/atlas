# Atlas Discount & Specialty Pricing Strategy

## Philosophy

Atlas offers discounts to mission-aligned segments to support civic research while maintaining sustainability. **Priority: mission alignment > sustainability > market growth.**

Discounts target the **smallest populations with the greatest resource constraints**, maximizing impact while minimizing revenue cannibalization. All discounts are **segment-based** (not characteristics-based), verified at signup, and documented for auditing.

**Excluded:** For-profit companies and political campaigns, regardless of claimed mission.

## Launch Segments (Go-Live)

Three segments launch with the product:

### Independent Journalists
**Discount:** 50% off Pro and Team pricing

**Who qualifies:**
- Solo journalists or freelancers doing civic reporting
- Bylined published work in reputable outlets (online or print)
- No organizational affiliation (or freelance status despite affiliation)

**Verification:**
- Portfolio link (published clips, byline, author page)
- Self-attestation of freelance/independent status
- Manual review for borderline cases

**Pricing:**
- Pro: $2.50/mo or $24/yr (was $5/mo, $48/yr)
- Team: $12.50/mo base + $4/seat/mo (was $25/mo base + $8/seat/mo)
- Research Pass: $6.75/30d or $3/7d (was $9/30d, $4/7d) — 25% discount

### Grassroots Nonprofits
**Discount:** 40% off Team pricing

**Who qualifies:**
- IRS 501(c)(3) verified status
- Annual budget < $2M
- Doing frontline civic work: community organizing, local advocacy, civic education, transparency work

**Verification:**
- IRS nonprofit lookup (automated database check)
- Budget attestation (Form 990 if available, self-reported if not)
- Manual review if budget boundary is unclear

**Pricing:**
- Pro: Not eligible (Team is the right tier for organizations)
- Team: $15/mo base + $4.80/seat/mo (was $25/mo base + $8/seat/mo)
- Research Pass: $6.75/30d or $3/7d — 25% discount

### Civic Tech Workers
**Discount:** 50% off Pro and Team pricing

**Who qualifies:**
- Building tools, infrastructure, or platforms for civic engagement, government accountability, or civic research
- Open-source projects, nonprofit tech organizations, early-stage civic tech startups
- Primary work is civic mission, not coincidental civic applications

**Verification:**
- GitHub repo link or public project page
- Mission statement or README explaining civic purpose
- Self-attestation of primary mission
- Manual review for clarity

**Pricing:**
- Pro: $2.50/mo or $24/yr
- Team: $12.50/mo base + $4/seat/mo
- Research Pass: $6.75/30d or $3/7d — 25% discount

## Free Tier (Unchanged)

No discounts apply to Free tier—it's already free and mission-aligned.

## Revenue & Sustainability Constraints

**Monitor and maintain:**
- Discounted users should not exceed 15% of total revenue
- Track discount cohort churn against full-price cohorts
- Quarterly fraud audits of verification claims
- Only expand to new segments if current discounts trend toward sustainability targets

## Expansion Framework

**Expand to new segments when:**
1. Launch segment verification process is stable and proven low-fraud
2. Discount program demonstrates revenue sustainability (discounted + full-price revenue healthy)
3. Support/admin infrastructure can handle added verification complexity
4. Product is operationally stable

**Future expansion candidates (priority order):**
1. University/K-12 education (.edu email verification)
2. Mid-size nonprofits ($2M–$25M budget)
3. Government civic agencies (local/state transparency)
4. International civic organizations
5. Early-stage civic tech startups
6. Foundation program officers (lightest discount)

Expansion is milestone-based, not timeline-based. New segments are added only when guardrails indicate readiness.

## Implementation Details

### Signup & Verification Flow

1. **Pricing page discount link** — Add small call-out: "Nonprofit? Independent journalist? Civic tech worker? Check eligibility →"
2. **Eligibility form** — Simple dropdown to select segment
3. **Verification** — Segment-specific form:
   - **Independent journalists:** Portfolio link input + self-attestation checkbox
   - **Grassroots nonprofits:** EIN or nonprofit name (auto-lookup IRS database) + budget confirmation
   - **Civic tech:** GitHub URL or project link + mission statement textarea
4. **Verification decision** — Automated for low-risk (IRS lookup, .edu email), manual for high-friction (portfolio review, civic tech evaluation)
5. **Customer metadata** — Flag verified discount segment in customer object (`discount_segment: "independent_journalist"`, `verified_at`, `verification_status`)

### Pricing Implementation

**Stripe:**
- Create new price objects for each discounted tier (e.g., `price_pro_independent_journalist_monthly`, `price_team_grassroots_nonprofit_monthly`)
- Store in environment variables alongside standard prices
- Apply correct price at checkout based on verified segment

**Billing state:**
- Store `discount_segment` and `verification_status` in Better Auth organization metadata (alongside `tier`)
- Verification expires after 12 months; require re-verification annually (light re-check)

### Admin & Auditing

**Dashboard requirements:**
- View all discount cohorts: segment, count, MRR, churn rate
- Pending verification queue with details
- Fraud flags and audit history
- Ability to manually approve/deny/revoke discounts

**Quarterly review:**
- Segment churn vs. full-price churn
- Revenue % from discounted vs. full-price
- Fraud incidents and patterns
- Decision on expansion readiness

## What This Does NOT Cover (Future Work)

- Discount code / coupon system (handle one-off discounts later)
- Tiered nonprofit discounts by budget size (start with single <$2M tier)
- Characteristics-based discounts (stay segment-based)
- International nonprofit verification (Phase 2+)
- Startup/early-stage civic tech (Phase 2+)

## Success Criteria

✅ Three launch segments live and verified at signup  
✅ No more than 15% of revenue from discounts  
✅ Fraud rate < 2%  
✅ Discount cohort onboarding/support is scalable  
✅ Clear expansion readiness criteria defined and tracked  

