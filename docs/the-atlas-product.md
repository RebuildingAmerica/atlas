# The Atlas

## A Map of Who's Rebuilding America, and Where

_Created for the Rebuilding America initiative — open-source and independently
useful_

> [!IMPORTANT] **First principle: [Experience First](./experience-first.md).**
> The end-user experience is the product and the reason this nonprofit exists —
> read it before contributing.

---

### The Problem

Across the country, people are doing the work — organizing tenants, building
worker cooperatives, advocating for transit, running community health centers,
fighting for clean water, reimagining public safety. They're in every state,
every city, often working in isolation, rarely visible beyond their immediate
community.

If you want to find them — whether you're a producer trying to tell their
stories, a viewer who just watched something that fired you up, or an organizer
looking for allies in a new city — there's no good way to do it. The information
is scattered across local news articles, nonprofit websites, podcast interviews,
city council records, and social media. No one has assembled it into a single,
searchable, source-linked map.

The Atlas is that map.

### What It Is

The Atlas is a national directory of people, organizations, and initiatives
working on the issues that define this moment in American life — housing,
healthcare, climate, democracy, labor, education, justice, infrastructure, and
the connective tissue between them.

Every entry is tied to a specific place and tagged with the issues it connects
to. Every entry traces back to the public sources where the information came
from. The Atlas doesn't assert — it documents, links, and organizes what's
already in the public record.

At its core is an **autodiscovery engine**: a pipeline that takes a location and
a set of issues as input and systematically finds who's doing what there by
searching across local journalism, nonprofit directories, organizational
websites, academic research, and civic records. It extracts structured data from
what it finds, deduplicates, ranks by relevance, and presents the results for
review.

The end-user experience is the product. The autodiscovery pipeline, the
database, and the public directory all exist to produce and present an
experience people can trust and use: the pipeline is how we find what's true;
the experience of finding, trusting, and acting on it is what we actually ship.
(See [Experience First](./experience-first.md) — the principle that outranks
everything else in this project.)

### Product Domains

Atlas has four product domains. They are not sales packages or internal teams.
They are the durable parts of the product a user should be able to feel:
discovery, proof, change, and workflow.

#### 1. Atlas Directory

Atlas Directory is the public civic discovery surface. It is where a person
starts when they want to understand who is doing meaningful civic work in a
place, issue area, organization, initiative, campaign, or community.

The Directory includes public search, browse, maps, profiles, place pages, issue
pages, partner directories, and source-linked result cards. Its job is to help a
first-time user move from a plain question - "who is working on housing in
Detroit?" - to a clear, inspectable set of people, organizations, initiatives,
sources, and relationships.

The Directory must remain useful without enterprise workspace context. It is the
civic commons and the product's first trust signal. Paid customer work can
improve it by adding public-safe records, better sources, fresher claims, and
stronger coverage, but basic public discovery is not the thing Atlas sells away.

The end-user outcome is simple: a resident, journalist, organizer, funder, or
viewer can find real civic actors and understand why they are appearing in the
result.

#### 2. Atlas Trust

Atlas Trust is the proof layer. It makes Atlas safe enough to publish claims
about real people and organizations, and useful enough that serious users can
rely on what they see.

Trust includes sources, claims, evidence packets, confidence, freshness,
corroboration, source diversity, review state, corrections, disputes, profile
claiming, stewardship, suppression, audit history, and public/private evidence
boundaries. It is not a compliance add-on. It is the difference between Atlas
and a scraped directory, a search result, or an AI answer that cannot show its
work.

Every surface should preserve trust context. A profile, search card, brief,
export, API response, MCP response, directory page, or monitoring digest should
make it clear where the information came from, how fresh it is, how confident
Atlas is, and what remains uncertain.

The end-user outcome is trust with agency: a user can inspect the evidence,
notice uncertainty, correct mistakes, and decide what to do next without being
asked to accept a black-box claim.

#### 3. Atlas Firehose

Atlas Firehose is the civic signal and change-intelligence layer. It turns
public activity into source-backed updates that make Atlas feel alive without
becoming noisy or unsafe.

Firehose watches for public civic signals: meetings, hearings, agendas, votes,
rulemaking, comment windows, public events, mobilizations, coalition
announcements, grant awards, filings, local news, nonprofit updates, campaign
pages, public-role activity by public people, and other public records of civic
activity. These signals are leads, not truth. Firehose captures them, classifies
them, resolves them to Atlas actors and places, checks provenance, scores
relevance and safety, and routes them to the public graph, a watchlist, a brief,
a coverage gap, or a human review queue.

The product promise is not "every event happening in America." The promise is
"what changed in this civic field, who is connected to it, what source proves
it, and what should someone inspect next?"

Firehose should favor places, issues, organizations, initiatives, campaigns,
public events, coverage targets, and public people acting in public roles:
elected officials, candidates, appointed officials, agency leaders, union
leaders, nonprofit executives, funders, public spokespeople, coalition leads,
journalists, researchers, and other civic actors whose public actions shape the
field. Monitoring individual people outside public-role context requires
stricter limits and review. Atlas must not become a surveillance feed, a
private-person targeting system, or a source-stripped event broker.

The boundary is the public realm. A person appearing in a public meeting, public
comment, public filing, public news story, public organizational role, public
campaign, public event, or public civic activity can be part of Atlas when that
appearance is source-backed and relevant to civic understanding. Public does not
mean context-free: Atlas should preserve the source, explain the public role or
event, avoid implying more than the evidence supports, and keep private-life
inference out of the product.

Atlas should still be detailed. Firehose should operate as close to the
public/private boundary as Atlas can responsibly stand: rich enough to capture
names, roles, affiliations, dates, jurisdictions, organizations, public
statements, relationships, event context, and source passages when those details
are public, relevant, and necessary for civic understanding. The product should
not retreat into vague summaries just because the facts involve a person. The
line is private-life inference, hidden data, disproportionate exposure, and
details that create risk without civic value.

The end-user outcome is timely civic awareness: a user can see what changed
since last time, open the source, understand the connection, and act with more
context.

#### 4. Atlas Workbench

Atlas Workbench is the professional workflow layer. It is what lets teams do
real work with the public map and trust layer without turning the public product
into a generic enterprise dashboard.

Workbench includes research runs, briefs, evidence packs, saved lists, private
notes, coverage targets, watchlists, monitoring digests, team workspaces,
exports, API and MCP access, CRM or spreadsheet handoff, package entitlements,
and customer delivery artifacts. It is the primary paid product surface because
institutions pay for speed, repeatability, collaboration, monitoring, and
integration - not for exclusive ownership of public civic facts.

Workbench should stay quiet and utility-first. It exists to help journalists,
creators, nonprofits, funders, coalitions, and civic institutions turn Atlas
records into decisions, stories, partnerships, funding choices, outreach, field
strategy, and public-good outputs.

The end-user outcome is usable civic intelligence: a team can move from a search
or signal to a brief, list, export, watch, coverage target, or next research
action with the evidence still attached.

#### Revenue Is Packaging, Not A Product Domain

Atlas makes money by packaging workflow, coverage, monitoring, integration,
deployment, and underwriting around these domains. Revenue is not a fifth
product domain. It is an operating doctrine: paid work should strengthen or
protect public civic discovery whenever it is safe, and private customer value
should not privatize the public civic graph.

### Who It's For

**Researchers and organizers**: Go from "I'm heading to Kansas City next week"
to "here are 40 source-linked leads organized by issue area, with contact
surfaces and gap analysis" in under an hour. Whether you're a journalist finding
sources, an advocacy group scoping a new city, or a documentary production team
(like Rebuilding America's) looking for people to talk to — the Atlas turns
location-based civic research from days of manual searching into a structured,
repeatable process.

**The public**: A searchable, browsable directory that anyone can use. Someone
reads about transit issues in Kansas City, opens the Atlas, and finds the people
and organizations doing that work. An organizer in Boise looks up who's working
on housing affordability in their city. A journalist finds sources for a story
about environmental justice in Louisiana.

**Developers and integrators**: Atlas exposes a REST API. Build on top of it —
embed directory data in your own site, connect it to other civic tech tools, or
extend the pipeline with new source types and extraction strategies.

### What An Entry Looks Like

Every entry in the Atlas represents a person, organization, initiative,
campaign, or event tied to a place and a set of issues.

A strong entry: _"Maria Gonzalez — founder of Prairie Workers Cooperative in
Garden City, KS. A worker-owned cleaning cooperative started after meatpacking
plant automation displaced 200+ workers. The co-op now employs 45 people.
Sources: Wichita Eagle (Jan 2026), KMUW (Dec 2025)."_

A weak entry: _"The Sierra Club has a Kansas chapter."_

The Atlas is designed to surface the first kind — specific people doing specific
things in specific places — by prioritizing sources that contain that level of
detail: local journalism, longform features, podcast interviews, organizational
profiles with program-level descriptions.

### How the Pipeline Works

1. **You specify a location and issue areas.** "Kansas City + transit, housing,
   worker power."

2. **The system generates dozens of targeted searches** across source types —
   local news, nonprofits, organizations, academic and policy research, civic
   records.

3. **AI reads each source and extracts structured data** — names, organizations,
   what they do, where, which issues they connect to, and any public contact
   information.

4. **Duplicates are detected and merged.** The same person appearing in three
   different articles becomes one entry with three source links.

5. **Results are ranked** by source density (how many independent sources
   mention them), recency (how recently), and contact surface completeness (can
   you reach them).

6. **You review and triage.** Confirm, edit, or discard.

7. **The system reports gaps.** "Strong coverage on transit and housing for KC.
   Zero leads for harm reduction, environmental justice, and broadband." You
   decide what to do about it.

The pipeline can run on a schedule — initial deep research ahead of time,
periodic refreshes to keep entries current. The public Atlas stays up to date as
the pipeline keeps discovering.

### Integration

- **REST API** — Atlas exposes all directory data through a public API. Other
  applications can pull entries, sources, and discovery results.

- **Embeddable** — the public Atlas can be self-hosted or embedded on any
  website.

- **Extensible taxonomy** — the issue taxonomy is maintained in the project and
  open to contribution. Originally developed for the Rebuilding America
  initiative, it covers the major domains of civic work across the U.S.

Atlas was created alongside other Rebuilding America tools — including a
documentary series and a civic engagement platform. It's designed to stand on
its own as a public directory and open-source project.

### How the Domains Work Together

The four domains should reinforce each other instead of becoming separate
products.

Directory gives users a public place to start. Trust explains why any result
deserves attention. Firehose keeps the map current and turns public activity
into meaningful change. Workbench lets people and teams turn that knowledge into
briefs, lists, exports, watches, and decisions.

When Atlas adds a new feature, it should be clear which domain it strengthens
and what user experience improves. A new data source belongs only if it helps a
user see, trust, understand, or act. A new workflow belongs only if it keeps
evidence attached. A new revenue package belongs only if it funds or improves
the public map without weakening the public trust standard.
