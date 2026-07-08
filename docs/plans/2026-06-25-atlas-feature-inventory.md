# Atlas — Feature Inventory

> An exhaustive, tagged inventory of **188 feature / subproduct / workflow
> ideas** across 16 lenses, grounded in Atlas's actual substrate (data model,
> discovery pipeline, multi-tenancy, MCP/API) and gated by the experience-first
> and trust-first principles. Drafted 2026-06-25.

> **This is a tactical inventory, subordinate to
> [`docs/roadmap.md`](../roadmap.md).** The roadmap is the single source of
> truth for _direction and sequencing_ — what we build next and why (its tracks
> and Now/Next/Later milestones, including the product-and-platform bet in Track
> 10). This document is the _menu_ the roadmap draws from. If the two ever
> conflict, the roadmap wins.

## What this is (and isn't)

The ask was an exhaustive set of features, subproducts, and workflows — useful
for the people Atlas serves, including other nonprofits — to seed the product
development lifecycle. This is that menu. Two framing decisions shaped it, and
both now live in the roadmap as the canonical record:

1. **Product _and_ platform.** Atlas is a trust-first research product
   (subscribers) _and_ white-label infrastructure other orgs build their own
   branded civic directories on. "Other nonprofits as customers" = both users
   and tenants. → roadmap "What Atlas Is Becoming" + Track 10.
2. **Lead segments**: local journalists & newsrooms, independent creators &
   researchers, national nonprofits & advocacy orgs; funders & foundations
   secondary. → roadmap "Primary Users".

Every item is gated by the same question: _what can the end user now SEE, TRUST,
FEEL, or DO that they couldn't before?_ Complexity is a cost, never an
achievement; trust is the thesis.

## How to read the inventory

Each item is tagged **`layer · horizon · feasibility`** and _segments_.

- **layer** — `product` (end-user app) · `platform` (white-label / API / tenant
  infra) · `infra` (data/pipeline plumbing, justified only by the experience it
  unlocks) · `gtm` (go-to-market / sustainability).
- **horizon** — `now` · `next` · `later`. These map directly onto the roadmap's
  `Now` / `Next` / `Later` status legend; the roadmap, not this file, decides
  actual sequencing.
- **feasibility** — `low` (days) · `medium` (weeks) · `high` (a quarter+).
- **segments** — `journalists` · `creators` · `nonprofits` · `funders` · `all`.

The 16 lenses (A–P) are organizing buckets, not build order. Full per-feature
"experience" and "builds-on-this-code" annotations are preserved in the
generation artifact and should seed individual feature specs.

## Flagship subproducts — the 8 big bets worth branding & resourcing

These are the named products the catalog rolls up into. Resource these; treat
individual catalog items as their components.

- **Atlas Research — the source-linked discovery engine.** The flagship surface:
  a research run (free-text goal, place, issue) fires queries through
  multi-provider search, extracts and dedups actors, passes them through the
  trust gate, and returns _The Brief_ — a ranked, source-linked deliverable with
  the verbatim passages that prove each claim, a coverage/gap section, and
  honest "we couldn't find" notes. Includes the Live Research Console, Research
  Goal Runs, Recurring Digests, and scope-boxed Research Passes. _Why it
  matters:_ this is what the three lead segments actually pay for and the
  clearest expression of the moat — not a generic chatbot, but a research
  instrument that refuses to bluff. Every output is defensible-in-print.
- **Trust Layer — provenance, corroboration & freshness made visible.** The
  cross-cutting trust system as first-class UI: per-claim Receipts, the
  Corroboration Meter (distinct publishers, not raw rows), the Freshness
  Watermark, Verified-vs-Found color-coding, Fact-Check Mode, Contradiction
  Flags, the "This Is Wrong" correction flow, and the Trust Diff Feed — backed
  by the Claim Ledger and source-trust scoring. _Why it matters:_ trust is the
  entire product thesis and the one thing competitors can't fake. It is what
  lets a newsroom, a funder, and a coalition all stake their reputation on what
  Atlas shows.
- **Civic Graph & Map — the traversable relationship layer.** Persisted, typed,
  per-edge-sourced relationships (founder/board/staff/funds/coalition/partner)
  rendered as the Graph Explorer, Connection Receipts on every edge, Org Charts
  & Coalition Rosters, Entity Timelines, side-by-side comparison, and
  Place/Issue ecosystem pages. _Why it matters:_ Atlas's most visually
  differentiated surface and the "Crunchbase for civic actors" promise —
  relationships-with-evidence that no spreadsheet or generic search gives you.
- **Atlas Monitor — standing intelligence on a beat.** Monitoring built on a
  first-class Watch object: Since-Last-Time diffs, Weekly Field Briefings, the
  Significance Gate (signal not noise), Emerging-Issue Radar,
  coverage/saturation alerts, confidence-drift & source-decay alerts, the
  Workspace Intel Inbox, and a Briefing API with webhooks. _Why it matters:_
  converts a one-shot brief into a recurring relationship (and recurring
  revenue), and uniquely monitors _decay_, warning users before they republish
  something gone stale.
- **Atlas for X — the white-label civic directory platform.** Any workspace
  becomes a branded, custom-domain public directory or coalition map, with
  directory templates, bring-your-own-graph (private entities over the shared
  commons), per-tenant trust-gated discovery with cost sovereignty, a tenant
  admin console, analytics, embeds, and scoped API keys — maturing toward
  cross-tenant federation. _Why it matters:_ the platform thesis and long-term
  network effect — many orgs building on one substrate, sharing verified
  entities back into a trust-compounding commons.
- **Coalition & Field Workbench — the nonprofit/advocacy product.** The
  collaboration-and-field-mapping surface: Research Projects, shared lists,
  threaded comments and assignments, the Power Map Canvas on the connection
  graph, Coalition Spaces (co-curated living field maps), Ally Finder, the
  grasstops-vs-grassroots lens, Field Watch, and coalition exports / funder
  one-pagers. _Why it matters:_ nonprofits buy as teams and need to hand a
  fully-cited picture to a board or funder; this replaces the stale shared
  spreadsheet and produces the artifacts that unlock funding.
- **Atlas Open — API, MCP & embeds (build-on-Atlas).** Research-Run-as-an-API
  with webhooks, the MCP write tier (`run_research`, `watch_entity`),
  provenance-carrying tool results, feeds-as-a-surface (RSS/Atom/JSON per
  place/issue/watchlist), embeddable trust widgets, future team-chat apps,
  no-code connectors, advocacy-CRM sync, and bulk snapshots — extending into the
  Open Civic Data Commons. _Why it matters:_ reaches users where they already
  work (agents, team chat, CRMs, newsletters), and every payload carries its
  provenance, so Atlas's trust standard travels with the data.
- **Atlas Governance & Safety — the editorial trust backbone.** The Triage Desk
  console, the immutable Provenance Ledger audit log, Sensitivity Tiers, the
  Right-to-Be-Forgotten console, editorial roles & the verify step, Source Decay
  Watch, the Anti-Harvest Shield, the public Trust Report,
  minor/private-individual guardrails, and the Civic Ethics Board — plus
  per-tenant moderation boundaries. _Why it matters:_ Atlas publishes claims
  about real, named people, some of them organizers at genuine risk. Without a
  serious safety backbone the product is one bulk-scrape or one wrongful
  exposure away from harming the very people it exists to surface.

---

## Sequencing, themes, risks & metrics → the roadmap

Direction and sequencing live in **[`docs/roadmap.md`](../roadmap.md)** — its
tracks, the Now/Next/Later milestones, the platform Track 10, and the roadmap
rules. To avoid a second source of truth, this inventory deliberately does
**not** restate a sequencing plan, risk register, or metric set; use the horizon
tags above to place items within the roadmap's status legend.

## The catalog — 188 ideas across 16 lenses

#### A. Discovery & Research Engine (12)

1. **Research Goal Runs** `product·now·low` _journalists/creators/nonprofits_ —
   Add a free-text research goal to a discovery run so the engine optimizes
   queries, extraction, and ranking toward what the user is actually trying to
   find…
2. **The Brief** `product·now·medium` _journalists/creators/nonprofits_ — Make
   every research run produce a source-linked brief document — ranked leads, the
   key passages that prove each claim, a coverage/gap section…
3. **Research Receipts** `product·next·medium` _journalists/nonprofits/funders_
   — A reproducible, auditable record for every run: the exact queries issued,
   providers hit, sources fetched, what the trust gate held and why, and what it
   cost…
4. **Comparative Research** `product·next·medium`
   _journalists/nonprofits/funders_ — Run research against two places or two
   issues at once and get a side-by-side answer…
5. **Recurring Research Digests** `product·now·medium`
   _journalists/creators/nonprofits_ — Turn a saved research run into a standing
   beat: on each scheduled re-run, deliver only what is new or changed since
   last time, with sources, as a digest.
6. **Interview-Lead Finder** `product·next·medium` _journalists/creators_ — A
   research mode that ranks named people not by relevance alone but by how
   interviewable they are…
7. **Field Scan** `product·next·high` _nonprofits/funders_ — A national or
   multi-state landscape run for a single issue area: where the actors are
   concentrated, where the white space is…
8. **Grounded Q&A over MCP** `platform·next·medium`
   _creators/nonprofits/journalists_ — Natural-language question-answering
   through the MCP surface that answers strictly from sourced claims in the
   graph and explicitly refuses or hedges when no source…
9. **Gap-Driven Deepening** `platform·later·high`
   _nonprofits/journalists/funders_ — An agentic loop that reads a run's own
   GapReport and autonomously runs targeted follow-up searches to close the
   biggest gaps, within a hard budget…
10. **RFP and Grantee Discovery** `product·next·medium` _nonprofits/funders_ —
    Paste an RFP, grant brief, or program description and get matched civic
    actors with explicit fit evidence…
11. **Live Research Console** `product·now·low` _all_ — A real-time view of a
    run as it thinks: queries firing, sources landing, entries extracted…
12. **Provenance Drift Watch** `platform·later·high`
    _journalists/nonprofits/funders_ — Re-running research over time detects
    when a previously sourced claim has gone stale, changed, or been
    contradicted by a newer source…

#### B. Profiles, Civic Map & Knowledge Graph (12)

13. **Initiative & Campaign Detail Pages** `product·now·low`
    _journalists/creators/nonprofits_ — Real SSR profile pages for initiative,
    campaign, and event entities that keep those actors inspectable as
    source-linked research objects.
14. **Connection Receipts (Why Are These Two Linked?)** `product·now·low`
    _journalists/nonprofits_ — An expandable evidence drawer on every civic-map
    edge that shows the verbatim passage and source proving the link, not just a
    one-line reason.
15. **Typed Relationship Edges with Per-Edge Provenance** `platform·next·medium`
    _journalists/nonprofits/funders_ — Persist the
    founder/board_member/staff/officer/funds/coalition_member/fiscal_sponsor/parent_org/partner/ally
    edges the extractor already emits and discards…
16. **Org Charts & Coalition Rosters** `product·next·medium`
    _journalists/nonprofits/creators_ — A structured leadership/staff/board view
    on org profiles and a member roster on coalition profiles, rendered from
    typed edges.
17. **Entity Timeline (Career & History from Signals)** `product·next·medium`
    _journalists/creators_ — A vertical, dated timeline on each profile built
    from signals — board appointments, grant awards, 990 filings, coalition
    joins, and first/most-recent source dates.
18. **Graph Explorer (Traversable Civic Map)** `product·next·medium`
    _journalists/nonprofits/creators_ — A full-screen, pannable node-link
    explorer that lets a user expand outward from any actor…
19. **Place Pages (Civic Ecosystem of a City/County/State)**
    `product·next·medium` _journalists/nonprofits/funders_ — A page for every
    canonical US place that lists the actors anchored there, the issue areas
    they cover, demographic/economic context, and coverage gaps.
20. **Issue-Ecosystem Pages (Field Map per Issue Area)** `product·next·medium`
    _nonprofits/funders/journalists_ — A page per issue area (across the 11
    domains / ~51 areas) that maps the leading actors, their connections to each
    other, and geographic distribution of the field.
21. **Side-by-Side Actor Comparison** `product·now·low`
    _journalists/funders/creators_ — A comparison view that puts 2-4 actors in
    parallel columns — issue areas, geography, sources, key relationships,
    shared connections, and trust level…
22. **Embeddable Mini-Maps & Roster Widgets** `platform·next·medium`
    _journalists/creators/nonprofits_ — A source-linked, embeddable civic-map /
    roster / timeline widget (iframe or web component) that a newsroom, creator,
    or org drops into an article or their own site…
23. **Funder–Grantee Money-Flow Map** `product·later·high`
    _funders/nonprofits/journalists_ — A dedicated visualization of 'funds'
    edges — who gives money to whom, how much, in what year, for what program —
    sourced straight from 990 Schedule I and FEC.
24. **Influence & Centrality Views (Who Connects Whom)** `product·later·high`
    _journalists/nonprofits/funders_ — Computed graph-centrality lenses —
    connectors, brokers, and hubs within a place or issue…

#### C. Trust, Provenance & Verification (12)

25. **Receipts** `product·now·medium` _journalists/creators/all_ — Per-claim
    provenance: every sentence on a profile shows exactly which sources back it,
    with the verbatim passage that proves it on hover/tap.
26. **Corroboration Meter** `product·now·low` _journalists/nonprofits/all_ — A
    visible 1-to-N independent-source meter on every claim and profile that
    counts DISTINCT publishers, not raw source rows…
27. **Freshness Watermark** `product·now·low` _journalists/creators/all_ — A
    staleness watermark that visibly de-emphasizes and labels claims whose
    newest backing source is old…
28. **Cite This** `product·now·low` _journalists/creators/all_ — One-click
    citation export for any claim or whole profile: copy a formatted,
    source-linked citation block (APA/MLA/Chicago/plain) listing the underlying
    sources…
29. **Verified vs. Found** `product·next·medium` _journalists/nonprofits/all_ —
    An honest, color-coded provenance ledger that separates registry-verified
    facts (EIN/FEC/990/government record) from web-discovered facts from
    subject-asserted…
30. **Contradiction Flags** `platform·next·high` _journalists/nonprofits/all_ —
    Automated contradiction detection that flags when sources disagree on a fact
    (different founding year, title…
31. **This Is Wrong** `product·next·medium` _nonprofits/all_ — A structured
    per-claim correction flow for subjects and the public: dispute a specific
    fact (not just flag the whole profile)…
32. **Source Trust Score** `platform·next·medium`
    _journalists/nonprofits/funders_ — A transparent, explainable source-quality
    score per publisher (independence, type, primary-vs-secondary…
33. **Fact-Check Mode** `product·next·medium` _journalists/creators_ — A toggle
    that strips a profile down to only registry-verified and
    multi-source-corroborated claims, hiding everything single-sourced or
    self-reported…
34. **Trust Diff Feed** `product·next·medium` _journalists/nonprofits_ — A
    provenance changelog on every profile and in the follow feed: when a claim
    gains a corroborating source, loses one to retraction, goes stale, or is
    corrected…
35. **Confidence-Gated Publishing** `platform·later·high`
    _nonprofits/creators/funders_ — A per-tenant confidence-threshold dial for
    white-label directories: each org sets the minimum
    corroboration/recency/registry grade required for a claim to even…
36. **Provenance Passport** `platform·later·high`
    _journalists/nonprofits/funders/all_ — A cryptographically signed, portable
    provenance record (C2PA-style) for any claim or profile that an external
    site can embed and independently verify back to…

#### D. Monitoring, Alerts & Strategic Intelligence (12)

37. **Watch (place / issue / actor / cluster)** `product·now·low`
    _journalists/creators/nonprofits_ — A first-class 'Watch' object that any
    browse query, profile, connection cluster, or map cell can be turned into,
    becoming the unit every alert, digest…
38. **Since Last Time** `product·now·medium` _journalists/creators/nonprofits_ —
    A diff view on any Watch that shows only what is new or changed since the
    user last looked…
39. **Weekly Field Briefing** `product·next·medium`
    _journalists/creators/nonprofits_ — An auto-generated, source-linked weekly
    email per Watch — a real editorial briefing on a beat, not a notification
    dump.
40. **Significance Gate (signal, not noise)** `platform·now·medium` _all_ — A
    scoring layer that classifies every detected change into signal vs. noise so
    alerts only fire on changes that actually matter, with a user-tunable
    threshold.
41. **Emerging-Issue Radar** `product·next·medium`
    _journalists/creators/nonprofits_ — A per-place trend view that surfaces
    which of the 51 issue areas are heating up — accelerating in new actors, new
    sources, and new coalitions — before it's obvious.
42. **Coverage & Saturation Alerts** `product·next·medium`
    _nonprofits/funders/journalists_ — Alerts that fire on the shape of coverage
    in a place/issue: 'this region just went from a gap to populated,' or 'this
    beat is saturated — diminishing returns.'
43. **Actor Dossier Alerts (board change / grant / new coalition)**
    `platform·later·high` _journalists/nonprofits/funders_ — Typed
    structured-change alerts on a watched actor — a board/leadership change, a
    new grant, a newly formed coalition, a new affiliation…
44. **Saved-Search & Map-Region Alerts** `product·now·low`
    _journalists/creators/nonprofits_ — Turn any search query or drawn map
    region into a standing alert: 'tell me when a new actor matching this
    appears.'
45. **Workspace Intel Inbox** `product·next·medium` _nonprofits/journalists_ — A
    shared, triageable inbox of detected changes across all of a workspace's
    Watches, with assign / dismiss / annotate, so monitoring becomes a team
    workflow.
46. **Confidence-Drift & Staleness Alerts** `platform·next·medium` _all_ — A
    trust-first monitor that alerts when a watched actor's data is going stale
    or a claim's confidence has dropped — so users hear about decay, not just
    growth.
47. **Briefing API & Webhooks (platform monitoring)** `platform·later·high`
    _nonprofits/journalists/funders_ — Programmatic Watches, deltas, and signal
    events exposed via REST/MCP and webhooks so partner orgs can pipe Atlas
    change-detection into their own tools and branded…
48. **Field State of Play (auto-briefing moonshot)** `product·later·high`
    _journalists/nonprofits/funders_ — A continuously self-updating, fully
    source-linked 'state of the field' report for any issue+geography —
    momentum, key actors, emerging coalitions, and gaps…

#### E. Newsroom & Journalist Workflows (12)

49. **Five-by-Five Local Voice Finder** `product·now·low` _journalists_ — A
    deadline-mode search that answers 'find me a local, reachable voice on X in
    Y by 5pm' with a ranked shortlist of named…
50. **Source Diversity X-Ray** `product·now·low` _journalists/creators_ — Paste
    your list of people you've already quoted (or a saved list of past sources)
    and Atlas tells you where your sourcing is concentrated and who you're
    missing.
51. **Interview-Prep Dossier** `product·now·low` _journalists/creators_ —
    One-click, source-linked briefing on any person before you call them: who
    they are, their affiliations, their stated positions, who they're connected
    to…
52. **Beat Landscape Maps** `product·next·medium` _journalists/nonprofits_ — A
    living, source-linked map of every actor on a beat in a region — the orgs,
    the people, the initiatives, and how they connect…
53. **Story-Idea Radar from Coverage Gaps** `product·next·medium`
    _journalists/creators_ — Atlas mines its own coverage-cell gaps to pitch you
    stories: actors doing notable work in your region or beat that the press has
    barely touched.
54. **Fact-Check Companion** `product·next·medium` _journalists_ — Drop a name
    and a claim ('Jane Doe runs the Tucson Tenants Union') and Atlas tells you
    what its sources support, what they contradict…
55. **Outreach Tracker** `product·now·low` _journalists/nonprofits_ — A
    lightweight contact-and-outreach log on top of every actor: who you've
    reached, what they said, when to follow up — private to your workspace.
56. **Newsroom Export Pack** `product·now·low` _journalists/creators/nonprofits_
    — Send any dossier, shortlist, or beat map straight into a Google Doc, Word
    file, or your CMS with sources rendered as proper footnotes and links
    intact.
57. **Election & Local-Government Coverage Kit** `product·next·medium`
    _journalists_ — A drop-in kit for covering a specific race or local body:
    candidates, incumbents, the orgs backing them, donors and connections…
58. **Public-Records Lead Builder** `product·later·high`
    _journalists/nonprofits_ — Turns an actor into a FOIA/public-records
    starting point: the agencies, identifiers, and registry hooks (EIN, FEC ID…
59. **Trust Provenance Inspector** `product·later·medium` _journalists_ — Click
    any single claim on a profile and see exactly which source proves it, when,
    by whom, and how confident Atlas is — claim-by-claim, not just per-profile.
60. **Editor's Standing Brief** `platform·later·high` _journalists/nonprofits_ —
    A branded, embeddable, always-fresh beat brief a newsroom can run on Atlas
    infrastructure…

#### F. Nonprofit, Advocacy & Coalition Workflows (12)

61. **Landscape Brief** `product·now·low` _nonprofits/funders_ — A one-click,
    source-linked 'who's already working on this here' report for a place plus a
    set of issue areas, generated before you ever enter a community.
62. **Field Gap Radar** `product·now·low` _nonprofits/funders_ — A
    place-by-issue heatmap that surfaces the issues and sub-geographies where
    almost no civic actor exists - the white space where a coalition or grant is
    most needed.
63. **Power Map Canvas** `product·next·medium` _nonprofits/journalists_ — An
    interactive stakeholder/power-mapping board built directly on Atlas's
    computed connection graph…
64. **Coalition Spaces** `platform·next·medium` _nonprofits_ — Shared,
    collaboratively-maintained maps of a field that multiple partner orgs
    co-curate inside one workspace - a living coalition roster instead of a
    stale shared…
65. **Grasstops vs Grassroots Lens** `product·next·medium` _nonprofits/funders_
    — A view that classifies actors in a place along a grasstops-to-grassroots
    spectrum using source mix, affiliation…
66. **Ally Finder** `product·now·low` _nonprofits_ — Given an actor or org you
    already trust, surface the strongest candidate allies working the same issue
    in the same place that you are NOT yet connected to.
67. **Rapid-Response Brief** `product·next·medium` _nonprofits/journalists_ — An
    on-demand, fast discovery run scoped to a single place + issue that returns
    a source-linked actor brief when a story or crisis breaks and you need
    'who's on the…
68. **Branded Coalition Directory** `platform·later·high` _nonprofits_ — A
    white-label, API-first public directory a coalition or national org can
    publish on its own domain - their curated subset of Atlas's actors…
69. **Decision-Maker & Legislative Ally Finder** `product·later·high`
    _nonprofits/journalists_ — A campaign-target view that ties named
    decision-makers to a place and issue and ranks them by how connected they
    already are to actors in your coalition.
70. **Field Watch** `product·next·medium` _nonprofits/journalists_ — A standing
    monitor over a place + issue that alerts a coalition when a new actor
    appears, an actor's coverage shifts, or a gap finally gets filled.
71. **Coalition Export & Funder One-Pager** `product·now·low`
    _nonprofits/funders_ — Turn any coalition space, power map, or landscape
    brief into a clean, fully-cited export (PDF/CSV) a coalition can hand to a
    board or a funder.
72. **Field Truth Guard** `platform·later·high` _nonprofits_ — A
    coalition-facing trust layer that flags when an actor's profile is stale,
    thinly-sourced…

#### G. Funder & Foundation Workflows (secondary) (11)

73. **Field Scan** `product·now·low` _funders/nonprofits_ — A funder picks an
    issue area plus a geography and gets a source-linked landscape of who is
    actually doing the work there, ranked by activity and corroboration…
74. **Grantee Shortlist Builder** `product·now·low` _funders/nonprofits_ — A
    saved list specialized for grantmaking: add candidate orgs, and each row
    auto-fills a diligence strip (EIN, tax subtype, registry-corroboration…
75. **Due-Diligence Dossier** `product·next·medium` _funders_ — One click on a
    candidate org produces a board-ready, fully cited diligence dossier:
    leadership and board, money in and out, coalition memberships, recent
    activity…
76. **Co-Funder Finder** `product·next·medium` _funders_ — On any grantee or
    shortlist, surface the other funders already giving to it or to its closest
    peers, ranked by overlap…
77. **Funding Gap Map** `product·next·high` _funders/nonprofits/journalists_ — A
    place-by-issue heatmap of where the money goes versus where the actors and
    need are, exposing the white space…
78. **Portfolio Watch** `product·next·medium` _funders/nonprofits_ — Upload or
    build your grantee portfolio and get a monitored feed: new news mentions,
    board changes, 990 financial shifts, new coalition memberships…
79. **Emerging-Org Radar** `product·later·high` _funders/nonprofits_ — A
    pipeline view of young, thinly-covered organizations in a chosen place and
    issue, ranked by momentum (rising news velocity…
80. **Landscape Report Generator** `product·later·medium` _funders/nonprofits_ —
    Turn a Field Scan into a polished, fully-cited landscape report for a board:
    narrative sections per sub-issue, the key actors and their connections…
81. **Funder Atlas (white-label directories)** `platform·later·high` _funders_ —
    A foundation stands up its own branded, source-linked civic directory or
    coalition map on Atlas infrastructure…
82. **Conflict & Concentration Lens** `product·later·high` _funders/journalists_
    — Before funding, see the risk picture: board interlocks between this
    grantee and your other grantees, over-concentration where one funder
    dominates an issue…
83. **Funder API & Diligence Webhooks** `platform·later·medium` _funders_ — A
    programmatic diligence endpoint: a foundation's grants-management system
    calls Atlas with an EIN or name and gets back the resolved entity,
    corroboration level…

#### H. Independent Creator & Researcher Workflows (11)

84. **Footnote Engine** `product·now·low` _creators/journalists/all_ — One-click
    export of any profile, list, or connection claim as a fully-formatted
    citation block (Chicago, MLA, APA…
85. **Embeddable Entity Cards** `product·now·low` _creators/journalists_ — A
    paste-anywhere oEmbed/iframe card for any person or org that renders name,
    photo, custom_bio, top issue areas…
86. **Embeddable Civic Map** `product·next·medium`
    _creators/journalists/nonprofits_ — The strength-ranked connection map for
    any actor or saved list, packaged as a responsive…
87. **Research Notebook** `product·now·medium` _creators/journalists/nonprofits_
    — A personal workspace surface where a researcher pins entities, sources,
    and individual claims into named…
88. **Public Research Pages** `product·next·medium`
    _creators/journalists/nonprofits_ — Publish a Research Notebook as a
    shareable, SEO-indexed public page -- 'Here is my sourced map of X' -- with
    the creator's byline, a freshness banner…
89. **Guest Finder** `product·next·medium` _creators/journalists_ — A query that
    returns bookable-feeling guest candidates for a podcast or newsletter topic
    -- filtered by issue area, geography…
90. **Explainer Kit** `product·next·medium` _creators/journalists/nonprofits_ —
    Generate a topic starter pack for any issue area + geography: the key
    actors, their connections, a sourced timeline from published_date…
91. **Provenance Dataset Export** `product·now·medium`
    _journalists/nonprofits/creators_ — Export any list, search, or notebook as
    a structured dataset (CSV/JSON/Parquet) where every cell carries its source
    URL, publication, published_date…
92. **Reproducible Run Receipts** `platform·next·medium`
    _journalists/nonprofits/creators_ — Every discovery run a researcher
    executes is captured as a citable, re-runnable receipt…
93. **Freshness Watch for Pieces** `product·next·medium`
    _journalists/creators/nonprofits_ — Subscribe a published article or
    research page to its underlying entities so the author is alerted when a
    cited actor's facts change, a new source appears…
94. **Citable DOI-Style Snapshots** `platform·later·high`
    _journalists/nonprofits/creators_ — Mint a permanent, versioned,
    content-addressed snapshot of a research page or dataset -- a Zenodo-style
    civic-data DOI -- so a frozen…

#### I. Collaboration, Workspaces & Saved Research (11)

95. **Research Projects** `product·now·medium` _journalists/creators/nonprofits_
    — A first-class Project container that groups saved entries, notes, briefs,
    and discovery runs into one named, dated workspace artifact you can open,
    hand off…
96. **Shareable Saved Lists** `product·now·low`
    _journalists/creators/nonprofits_ — Promote today's personal saved lists
    into workspace-shared lists with public/private visibility…
97. **Threaded Entry Comments with @mentions** `product·now·medium`
    _journalists/nonprofits/funders_ — Turn the flat private org_annotations on
    an entry into resolvable comment threads with replies, @mentions, and a
    'needs another set of eyes' flag.
98. **Entry Assignments & Verification Tasks** `product·next·medium`
    _journalists/nonprofits_ — Assign an entry to a teammate with a status
    (to-verify / verifying / verified / parked) so a research project has a
    visible work queue, not just a bag of names.
99. **Export Center** `product·now·medium`
    _journalists/creators/nonprofits/funders_ — One place to export a project or
    list as CSV, JSON, a formatted PDF brief, or a citation bundle — every row
    carrying its sources and confidence, never a bare claim.
100.  **Citation Bundle Export for Journalists** `product·next·medium`
      _journalists/creators_ — A purpose-built export that emits, per claim, the
      verbatim passage that proves it plus the source's title, publication, and
      published date…
101.  **Project Templates & Duplicate-a-Project** `product·next·medium`
      _journalists/nonprofits/creators_ — Save a project's structure — its
      issue-area filters, geo scope, watchlist rules, and brief layout…
102.  **Project Activity Feed & Presence** `product·next·medium`
      _journalists/nonprofits/funders_ — A per-project timeline of every
      meaningful event — entry added, note left, assignment changed, discovery
      run completed, source suppressed…
103.  **Stakeholder Read-Only Share Links** `product·next·medium`
      _journalists/nonprofits/funders/creators_ — Publish a project or list as a
      polished, read-only, link-shareable view for a client, funder, or editor…
104.  **Project Version History & Snapshots** `product·later·high`
      _journalists/nonprofits_ — Named, dated snapshots of a project's full
      state so you can show 'this is exactly what we knew on March 3' and diff
      how the picture changed as sources updated.
105.  **Live Co-Research Session** `product·later·high`
      _journalists/creators/nonprofits_ — A real-time shared canvas where two or
      more teammates explore the civic connection graph together…

#### J. Platform & White-Label (Atlas for X) (12)

106. **Atlas Sites: white-label directory in a weekend** `platform·now·medium`
     _nonprofits/journalists_ — A self-serve mode that turns any workspace into
     a public, branded civic directory at the org's own subdomain (e.g…
107. **Co-brand bar + provenance footer ('Powered by Atlas')**
     `platform·now·low` _nonprofits/funders_ — A persistent, tasteful
     co-branding strip and per-claim provenance footer rendered on every tenant
     page so visitors trust the data and the shared infrastructure is…
108. **Directory Templates: 'Atlas for Housing', 'Atlas for <state>'**
     `platform·now·medium` _nonprofits/creators_ — Pre-baked starter kits that
     seed a new tenant site with the right issue-area filters, a scoped slice of
     the shared graph…
109. **Tenant taxonomy extensions (private tags, mapped to canon)**
     `platform·next·medium` _nonprofits/journalists_ — Lets a tenant add their
     own private issue tags and sub-categories on top of the canonical 51 issue
     areas without forking the shared taxonomy…
110. **Bring-your-own-graph: private entities that draw from the shared graph**
     `platform·now·medium` _nonprofits/journalists_ — A clear two-layer model
     where a tenant maintains private, org-owned entities and annotations that
     no other tenant sees…
111. **Per-tenant discovery runs with cost sovereignty** `platform·next·high`
     _nonprofits/funders_ — Tenants run the same trust-gated discovery pipeline
     scoped to their issues and geography, against their own metered budget…
112. **Tenant admin console: members, roles, publish gate**
     `platform·now·medium` _nonprofits/journalists_ — A first-class admin
     surface where a tenant owner manages members and roles, curates which
     entries are public, approves the review queue…
113. **Custom domains with verified ownership** `platform·next·medium`
     _nonprofits/creators_ — Lets a tenant serve their Atlas-powered directory
     on their own domain (directory.theirorg.org) with DNS-verified ownership
     and automatic TLS…
114. **Tenant analytics: reach, trust health, coverage gaps**
     `platform·next·medium` _nonprofits/funders_ — A tenant-scoped dashboard
     showing not just traffic but trust-health: how many published profiles are
     source-linked, how stale they are…
115. **Embeds & tenant API keys: directory as a widget** `platform·next·medium`
     _journalists/creators/nonprofits_ — Tenants embed their curated, branded
     directory (or a single profile card or map) as an iframe/web component in
     their own CMS…
116. **Cross-tenant federation: the network of branded directories**
     `platform·later·high` _nonprofits/funders/journalists_ — An opt-in
     federation layer where independently branded tenant directories share back
     verified entities into the commons and discover when a peer org already
     covers…
117. **Data-sovereignty & export controls per tenant** `platform·next·medium`
     _nonprofits/funders/journalists_ — Explicit, tenant-owned controls over
     what a tenant contributes to the commons versus keeps private, plus full
     export of their owned data…

#### K. API, MCP, Agents & Integrations (12)

118. **Atlas MCP Write Tier: run_research & watch_entity** `platform·now·low`
     _journalists/creators/nonprofits_ — Promote the MCP server from read-only
     lookup to an action surface that can queue a metered discovery run and set
     up a monitoring watch from inside any agent.
119. **Provenance-Carrying Tool Results (claim citations in every payload)**
     `platform·now·low` _all_ — Every MCP and REST response embeds the verbatim
     extraction_context passage, source URL, publication, published_date…
120. **Feeds-as-a-Surface: RSS/Atom/JSON Feed per place, issue, and watchlist**
     `product·now·low` _journalists/creators/nonprofits_ — Auto-generated,
     subscribable feeds — /feeds/place/toledo-oh.xml, /feeds/issue/housing.xml,
     /feeds/watchlist/{id}.xml…
121. **Embeddable Trust Widgets: civic-map, entity-card, place-page**
     `platform·next·medium` _journalists/creators/nonprofits_ — Three drop-in
     embeds — a strength-ranked civic connection map, a single source-linked
     entity card, and a place coverage page…
122. **Advocacy-CRM Sync: Action Network, EveryAction, NationBuilder,
     Salesforce** `platform·next·high` _nonprofits_ — A managed, bidirectional
     connector that pushes Atlas actors and connections into an org's advocacy
     CRM as records/tags and pulls back the org's own contacts to…
123. **Research-Run-as-an-API with Webhooks** `platform·next·medium`
     _journalists/creators/nonprofits_ — POST /v1/research-runs returns a job
     id; you poll or register a webhook and receive a structured, source-linked
     result set when Atlas finishes…
124. **Bulk Data API + nightly graph snapshots (NDJSON / Parquet)**
     `platform·next·medium` _creators/nonprofits_ — Cursor-paginated bulk export
     endpoints plus signed nightly snapshot files (entities, sources,
     entry_sources, connections…
125. **Team chat app: lookup, watch digests, claim alerts**
     `product·later·medium` _nonprofits/journalists_ — A future chat integration
     with a slash-command lookup surface, inline source-linked results,
     channel-posted watchlist digests…
126. **No-Code Connectors: Zapier, Make, Notion, Airtable, Google Sheets**
     `platform·next·medium` _creators/nonprofits/journalists_ — Published
     Zapier/Make apps plus native Notion/Airtable/Sheets connectors with
     triggers (new actor in watchlist, new source on entity…
127. **GraphQL Relationship API: traverse the civic graph in one query**
     `platform·next·medium` _creators/nonprofits_ — A GraphQL endpoint that lets
     clients fetch an entity, its strength-binned connections, the reasons…
128. **Connector SDK + white-label tenant API keys (build-on-Atlas substrate)**
     `platform·later·high` _nonprofits/funders_ — A typed Connector SDK and
     per-tenant scoped API keys/MCP endpoints so partner orgs build their own
     branded civic directories and coalition maps on Atlas data…
129. **Atlas Agent Protocol Pack: signed agent identity + auditable agentic
     research** `infra·later·high` _journalists/nonprofits_ — A published agent
     capability manifest plus signed, per-agent identities and a full audit
     trail of every tool call, so other people's autonomous agents can run…

#### L. Data Co-op, Contribution Loops & Network Effects (11)

130. **Suggest an Edit** `product·now·low` _all_ — An inline "Suggest an edit" /
     "Add a source" affordance on every public profile that routes
     community-submitted corrections, new facts…
131. **Source-Backed Submissions Only** `product·now·low`
     _journalists/creators/all_ — A contribution rule and UI that refuses any
     community add/correct unless it carries a source URL and the exact verbatim
     passage that proves the claim…
132. **Self-Service Verified Profile Studio** `product·now·low`
     _nonprofits/creators/all_ — Once an org or person passes a profile claim, a
     lightweight "profile studio" lets the verified owner directly maintain
     their own custom_bio, photo…
133. **Contributor Reputation & the Steward Ladder** `product·next·medium`
     _journalists/creators/all_ — A per-contributor reputation score earned from
     accepted edits/sources (and lost on rejected or flagged ones) that unlocks
     a "steward ladder"…
134. **Coverage Bounties for Sparse Cells** `product·next·medium`
     _journalists/nonprofits/funders_ — A public "thin map" board that surfaces
     under-covered geography+issue cells from coverage analysis and lets the
     community (or a sponsoring funder) post bounties…
135. **Reciprocal Give-to-Get Data Exchange** `platform·next·medium`
     _nonprofits/journalists_ — A partner-tenant sharing mechanism where a
     workspace can flip its private entries/sources to publicly contributed…
136. **Public Graph Changelog** `product·now·low` _all_ — A live, public "what
     changed in the civic graph" feed — new actors added, profiles verified,
     sources attached, coverage cells filled, contributions accepted…
137. **Open Civic Data Commons Export** `platform·next·medium`
     _journalists/creators/nonprofits_ — A versioned, openly-licensed public
     export of the source-linked graph (actors, sources, verbatim
     extraction_context, issue tags…
138. **Confirm-or-Correct Freshness Loop** `product·now·low` _all_ — A one-tap
     "Still accurate?" prompt shown to logged-in viewers and followers on aging
     profiles…
139. **Partner Registry Ingestion Adapters** `infra·next·medium`
     _nonprofits/funders_ — A standardized ingestion adapter framework that lets
     a partner org pipe a structured roster (CSV, Airtable, an EIN/FEC list…
140. **Branded Contribution Portals (White-Label Co-op Front Doors)**
     `platform·later·high` _nonprofits/journalists_ — A multi-tenant,
     white-label embeddable widget that lets a partner run an Atlas-powered "add
     a civic actor / correct this record" portal under their own brand on…

#### M. Coverage Engine & Data Pipeline (12)

141. **Coverage Grid** `infra·now·low` _journalists/nonprofits/all_ — A
     persisted place x issue-area x source-type coverage cell table that turns
     today's issue-only gap report into a queryable map of exactly where Atlas
     knows a lot…
142. **Priority Frontier** `infra·next·medium` _nonprofits/funders/all_ — A
     scheduler that ranks every coverage cell by an opportunity score
     (population x issue salience x current thinness x staleness) and auto-emits
     the next…
143. **Saturation Sense** `infra·next·medium` _funders/nonprofits_ — Per-cell
     saturation detection that watches the new-vs-duplicate ratio across
     successive runs and declares a cell 'saturated' when re-sweeps stop
     yielding net-new…
144. **Freshness SLA Engine** `infra·now·medium` _journalists/creators/all_ — A
     continuous re-discovery loop that assigns every entry a freshness target by
     tier (high-profile actors checked monthly…
145. **Registry Spine** `infra·next·high` _journalists/nonprofits/funders/all_ —
     Authoritative ingestion connectors (IRS Business Master File + ProPublica
     990s, FEC, Census/TIGER places, Wikidata, Candid…
146. **Identity Resolver** `infra·next·medium` _journalists/creators/all_ —
     Replace name+city string matching with deterministic identity resolution on
     stable keys (EIN, FEC committee ID, Wikidata QID, normalized domain…
147. **Corroboration Score** `infra·now·low`
     _journalists/creators/nonprofits/all_ — Replace flat source_density with a
     corroboration score that weights independent publishers, authoritative
     source types…
148. **Claim Ledger** `infra·later·high` _journalists/nonprofits/all_ — A
     per-claim claims table where each atomic fact (role, location, founding
     year, affiliation) is stored with its own sources, confidence, and as-of
     date…
149. **Golden Set Harness** `infra·next·medium` _all_ — A hand-curated golden
     set of known actors per region plus an automated eval (precision/recall on
     extraction, dedup correctness…
150. **Live Signal Intake (GDELT + News)** `infra·next·medium`
     _journalists/creators_ — A streaming news/social intake (GDELT plus a
     second news vendor through the existing SearchProvider seam) that surfaces
     freshly-mentioned actors and events within a…
151. **Spend Governor** `infra·now·low` _all_ — A per-cell, per-day, and global
     budget governor on top of the cost ledger with a one-click kill switch…
152. **Provenance Graph** `infra·later·high` _journalists/nonprofits/funders_ —
     Promote today's computed-on-the-fly connections into a persisted, sourced
     edges table where every relationship (employs, funds, co-founded…

#### N. Moderation, Editorial, Governance & Safety (12)

153. **Triage Desk** `product·now·medium` _all_ — A single internal moderation
     console that turns the review_queue, entity_flags, and source_flags into
     one prioritized work surface with disposition reasons…
154. **Provenance Ledger (immutable audit log)** `platform·now·medium` _all_ —
     An append-only audit_log recording every governance action — who approved a
     person, who suppressed a source, who claimed a profile, who honored a
     takedown…
155. **Sensitivity Tiers** `platform·next·medium` _nonprofits/journalists_ — A
     per-entry sensitivity classification (public_figure / civic_actor /
     private_individual / at_risk_organizer / minor) that changes how
     aggressively Atlas discovers…
156. **Right-to-Be-Forgotten Console** `product·now·medium` _all_ — A
     subject-facing 'this is about me' flow that lets a named individual request
     correction, suppression, or full removal…
157. **Editorial Roles & The Verify Step** `platform·next·medium` _all_ — A
     small role model — reviewer, senior editor, ethics lead — layered on
     capabilities, where escalation-worthy records (persons, at-risk tiers…
158. **Dispute & Correction Threads** `product·next·medium` _all_ — A structured
     back-and-forth on a contested claim where a subject or reader disputes a
     specific source-backed fact, an editor responds with the
     extraction_context…
159. **Anti-Harvest Shield** `infra·next·medium` _nonprofits/journalists_ —
     Rate-limiting, anomaly detection, and per-tier gating specifically designed
     to stop someone from bulk-scraping the contact details and locations of
     real organizers…
160. **Public Trust Report** `gtm·now·low` _all_ — An automatically generated,
     regularly published transparency page: how many records were held vs
     auto-published, flags received and resolved…
161. **Tenant Moderation Boundaries** `platform·next·high` _nonprofits/funders_
     — Per-workspace moderation policy for the platform/white-label tier: each
     org sets who can publish to their branded directory…
162. **Source Decay Watch** `platform·next·medium` _journalists/creators_ — A
     background job that re-checks whether the sources behind a claim still
     resolve, still say what we extracted, and aren't stale…
163. **Minor & Private-Individual Guardrails** `platform·later·high` _all_ —
     Hard, non-overridable extraction and display rules for people who are
     minors or non-public private individuals…
164. **Civic Ethics Board** `gtm·later·high` _nonprofits/funders/journalists_ —
     A standing external advisory mechanism — named outside reviewers from
     journalism, organizing, and civil-liberties communities…

#### O. Monetization, Pricing & Go-to-Market (12)

165. **Place + Issue Atlas Pages (Programmatic SEO Spine)** `product·now·medium`
     _all_ — Auto-generated, source-linked landing pages for every
     {city/state/region} x {issue area} combination…
166. **Source-Linked OG Cards + Embeddable Profile Badge** `product·now·low`
     _journalists/creators/all_ — Every profile and place/issue page generates a
     branded social-share image and a one-line copy-paste embed snippet ("As
     listed on Atlas…
167. **Verified Discount Programs, Productized (Newsroom / Nonprofit /
     Academic)** `gtm·now·low` _journalists/nonprofits/creators_ — Turn the
     half-built request-discount flow into self-serve, auto-verified discount
     tiers…
168. **Research Pass Variants: Project Pass & Grant-Cycle Pass**
     `product·now·low` _journalists/creators/nonprofits_ — Time-boxed and
     scope-boxed Research Pass SKUs — a 30-day Project Pass for a single
     investigation and a 6/12-month Grant-Cycle Pass sized to a foundation
     reporting…
169. **Coalition & Fiscal-Sponsor Group Plans** `product·next·medium`
     _nonprofits_ — A multi-org plan where one fiscal sponsor or coalition
     backbone pays once and provisions seats/sub-workspaces for its member orgs…
170. **Usage-Based API & MCP Metering with Honest Dashboards**
     `platform·next·medium` _all_ — Tiered usage-based pricing for the REST API
     and MCP server — included monthly quota plus metered overage…
171. **Underwriting & Sponsorship Layer ("Data brought to you by")**
     `gtm·next·medium` _nonprofits/funders/all_ — A public-radio-style
     underwriting model where a foundation or mission-aligned sponsor funds open
     access to a specific issue-area or region dataset…
172. **Distribution Partner Kit (J-Schools, Press Associations, Nonprofit
     Networks)** `gtm·next·medium` _journalists/nonprofits/creators_ — A
     co-branded onboarding + bulk-provisioning kit so a press association,
     journalism school…
173. **Referral & Contribution Loop (Earn Access by Improving the Graph)**
     `product·next·medium` _all_ — A loop where users earn research credits or
     extended access by contributing to trust…
174. **Ethical Civic-Data Licensing API (Provenance-Bundled Datasets)**
     `platform·later·high` _nonprofits/funders_ — Licensed bulk dataset access —
     issue-area or regional civic-actor datasets delivered with every claim's
     source URL, publication, date…
175. **Embeddable White-Label Directory Widget (Free-Tier Reach Engine)**
     `platform·later·high` _nonprofits/creators/journalists_ — A genuinely
     useful free embed: any org drops a snippet on their own site to render a
     live, Atlas-powered…
176. **Branded Civic Directory Platform (Multi-Tenant White-Label SaaS)**
     `platform·later·high` _nonprofits/journalists/funders_ — The full platform
     play: other orgs spin up their own branded, custom-domain civic directory
     or coalition map on Atlas infrastructure…

#### P. Cross-Cutting & Gap-Fill (12)

177. **First Run: Your First Brief in 60 Seconds** `product·now·low` _all_ — A
     guided first-run path that walks a brand-new user from sign-up to one
     finished, source-linked brief about a place and issue they care about…
178. **Relevance Rank (Search That Feels Right)** `product·now·medium`
     _all/journalists/creators_ — Replace recency-only result ordering with a
     transparent relevance blend of text match, corroboration/trust, geographic
     proximity to the query, and freshness…
179. **Map for Everyone (Accessible Civic Graph)** `product·now·medium` _all_ —
     A fully keyboard-traversable, screen-reader-narrated, and text-table
     fallback rendering of the civic connection map and US density map, so the
     most visual…
180. **Field Mode (Mobile & Low-Bandwidth)** `product·now·medium`
     _journalists/creators/nonprofits_ — A mobile-first navigation shell plus a
     text-first 'lite' rendering that drops the heavy map and images for a
     sourced list-and-contact view…
181. **Atlas en Espanol (Bilingual Civic Layer)** `product·next·high`
     _nonprofits/journalists/all_ — A Spanish-language UI plus per-entity
     language-of-source tagging and bilingual presentation…
182. **Your Data, Your Rights (Account Export & Deletion)** `product·now·medium`
     _all_ — A self-serve account control surface where any user exports
     everything they've created (lists, notes, runs…
183. **Provenance Export Engine** `platform·now·medium`
     _all/journalists/funders_ — The shared export service every export feature
     presumes: a single endpoint behind the workspace.export capability that
     emits CSV/JSON/Parquet where every cell…
184. **Sourced-Only Generation Guard** `platform·next·medium` _all/journalists_
     — A guardrail layer for every user-facing generated text (briefs,
     auto-bios, grounded Q&A) that constrains output to spans backed by
     entry_sources…
185. **Coverage Confidence Meter (Is Atlas Fresh Here?)** `product·next·medium`
     _all/nonprofits/funders_ — A per-view honesty banner on every place page,
     issue page, and search result set that shows how completely and how
     recently Atlas has covered that slice…
186. **Civic Calendar Surfacing** `product·next·high`
     _journalists/nonprofits/creators_ — A timing layer that ties place+issue
     actors to upcoming elections, legislative sessions, and filing deadlines…
187. **Honest States Kit (Empty, Loading, Degraded)** `product·now·low` _all_ —
     A systematic design pass and shared component set for sparse profiles,
     in-progress and failed runs, and degraded providers…
188. **Source-Rich Share Cards** `product·now·low` _creators/journalists/all_ —
     Auto-generated, branded social-share images and rich link previews for
     every profile, place page, and issue page that put the actor's name, photo,
     top issue…

---

## Coverage gaps to keep honest about

The completeness critic flagged these under-covered angles (most are now
addressed by lens P items #177–#188, but they deserve explicit ownership during
the PDLC):

- **First-run & onboarding** — the substrate's onboarding only covers workspace
  provisioning; there's no guided first research run or "aha in 60 seconds"
  path. → #177
- **Search relevance the user feels** — browse/search is
  `ORDER BY updated_at DESC` + bare FTS `MATCH` with no
  relevance/trust/proximity blend; nobody owns the typed-search ranking
  experience. → #178
- **Accessibility of the civic map specifically** — the connection graph and
  density map are inherently visual; no keyboard/screen-reader/text-table
  equivalent. → #179
- **Mobile & low-bandwidth** — no mobile nav primitive, no lightweight
  text-first mode for field reporters/organizers on bad connections. → #180
- **Spanish-language & multilingual civic content** — zero i18n; a platform
  about American community life ignores the largest non-English civic
  constituency. → #181
- **User data rights** (distinct from data-subject RTBF) — no account deletion,
  personal-data export, or consent/retention surface for the people who hold
  Atlas accounts. → #182
- **Export as a first-class service contract** — `workspace.export` is a
  capability flag with no endpoint; every export feature presumes an engine, a
  provenance-carrying schema, and honest partial/permission-denied states that
  don't exist. → #183
- **AI hallucination guardrails in user-facing prose** — grounded flags exist on
  data, but nothing constrains _generated_ text (briefs, auto-bios, Q&A) to
  sourced spans with visible inline citations and explicit refusal. → #184
- **User-facing observability of Atlas itself** — per-view
  freshness/completeness ("this place is 40% covered, last swept 9 days ago") so
  users calibrate trust before acting; today only per-entity freshness exists. →
  #185
- **Election & legislative-calendar timing** — no calendar-aware surfacing tied
  to upcoming races, sessions, or filing deadlines, despite the civic mission. →
  #186
- **Graceful degradation & honest empty/loading/error states** — empty-state
  components are auth-specific and scattered; sparse profiles, failed runs, and
  degraded providers have no designed honest fallback. → #187
- **Trust-building social proof & shareability** — only a bare `twitter:card`;
  no generated OG image, source-count-rich share card, or "who relies on Atlas"
  surface. → #188, #166
- **Saved-state portability & continuity** — no resume/restore of an interrupted
  research run or browse session, and no cross-device continuity for the core
  research loop. _(Still unowned — candidate for a near-term spec.)_

---

## How to use this inventory

1. **Direction first.** Decide _what's next_ from
   [`docs/roadmap.md`](../roadmap.md), then pull the concrete items that serve
   that milestone from the inventory above.
2. **Validate foundations against the code before building.** The blocking
   foundations this inventory surfaced — connections computed live with no edges
   table (`api/atlas/domains/catalog/models/connections.py`), provenance stored
   per-source-row rather than per-claim (`api/atlas/models/database.py`), no
   identity resolution on stable keys, initiative/campaign/event entities with
   no detail routes, and a `workspace.export` capability with no endpoint —
   align with the civic-knowledge-graph redesign
   (`docs/design/2026-06-23-discovery-platform-redesign.md`). Confirm them
   before writing specs.
3. **Write specs experience-first.** Each spec opens with "a user doing X can
   now SEE/TRUST/FEEL/DO Y" and names the substrate it builds on. Apply the
   trust-first check: does anything show a claim about a named person without
   provenance?
4. **Suggested first slice (tactical):** The Brief (#2) + Receipts (#25) +
   Corroboration Meter (#26) + Initiative/Campaign pages (#13) + the Provenance
   Export Engine (#183), riding on the Claim Ledger (#148) and Identity Resolver
   (#146). It makes a defensible, source-linked deliverable real end-to-end
   before any platform investment.

> **Scope discipline:** 188 ideas is the menu, not the commitment. The biggest
> risk is trying to serve four segments and a platform at once — the roadmap
> holds that line, and the platform layer must not outrun the product layer's
> trust maturity.
