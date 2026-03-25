# The Atlas
## A Map of Who's Rebuilding America, and Where

*Part of the Rebuilding America initiative*

---

### The Problem

Across the country, people are doing the work — organizing tenants, building
worker cooperatives, advocating for transit, running community health centers,
fighting for clean water, reimagining public safety. They're in every state,
every city, often working in isolation, rarely visible beyond their immediate
community.

If you want to find them — whether you're a producer trying to tell their
stories, a viewer who just watched something that fired you up, or an organizer
looking for allies in a new city — there's no good way to do it. The
information is scattered across local news articles, nonprofit websites,
podcast interviews, city council records, and social media. No one has
assembled it into a single, searchable, source-linked map.

The Atlas is that map.

### What It Is

The Atlas is a national directory of people, organizations, and initiatives
working on the issues that define this moment in American life — housing,
healthcare, climate, democracy, labor, education, justice, infrastructure,
and the connective tissue between them.

Every entry is tied to a specific place and tagged with the issues it
connects to. Every entry traces back to the public sources where the
information came from. The Atlas doesn't assert — it documents, links, and
organizes what's already in the public record.

At its core is an **autodiscovery engine**: a pipeline that takes a location
and a set of issues as input and systematically finds who's doing what there
by searching across local journalism, nonprofit directories, organizational
websites, academic research, and civic records. It extracts structured data
from what it finds, deduplicates, ranks by relevance, and presents the
results for review.

The autodiscovery pipeline is the product. Everything else — the database,
the interface, the public directory — exists to support and present what
the pipeline finds.

### Who It's For

**The production team** (during the Connecting America Tour): Go from "I'm
heading to Kansas City next week" to "here are 40 source-linked leads
organized by issue area, with contact surfaces and gap analysis" in under
an hour. The Atlas is how episodes get populated with real people and
real stories.

**The public** (permanently): A searchable, browsable directory that anyone
can use. A viewer watches an episode about transit in Kansas City, opens
the Atlas, and finds not just the people in the episode but others doing
related work nearby. An organizer in Boise looks up who's working on
housing affordability in their city. A journalist finds sources for a story
about environmental justice in Louisiana.

**The broader Rebuilding America initiative**: The Atlas is the connective
layer between the documentary series (which drives attention), Project
Lovelace (which drives civic engagement), and the communities doing the
actual work. The series tells stories. The Atlas makes those stories
actionable by showing people where to go and who to connect with.

### What An Entry Looks Like

Every entry in the Atlas represents a person, organization, initiative,
campaign, or event tied to a place and a set of issues.

A strong entry: *"Maria Gonzalez — founder of Prairie Workers Cooperative
in Garden City, KS. A worker-owned cleaning cooperative started after
meatpacking plant automation displaced 200+ workers. The co-op now employs
45 people. Sources: Wichita Eagle (Jan 2026), KMUW (Dec 2025)."*

A weak entry: *"The Sierra Club has a Kansas chapter."*

The Atlas is designed to surface the first kind — specific people doing
specific things in specific places — by prioritizing sources that contain
that level of detail: local journalism, longform features, podcast
interviews, organizational profiles with program-level descriptions.

### How the Pipeline Works

1. **You specify a location and issue areas.** "Kansas City + transit,
   housing, worker power."

2. **The system generates dozens of targeted searches** across source
   types — local news, nonprofits, organizations, academic and policy
   research, civic records.

3. **AI reads each source and extracts structured data** — names,
   organizations, what they do, where, which issues they connect to,
   and any public contact information.

4. **Duplicates are detected and merged.** The same person appearing in
   three different articles becomes one entry with three source links.

5. **Results are ranked** by source density (how many independent sources
   mention them), recency (how recently), and contact surface completeness
   (can you reach them).

6. **You review and triage.** Confirm, edit, or discard.

7. **The system reports gaps.** "Strong coverage on transit and housing
   for KC. Zero leads for harm reduction, environmental justice, and
   broadband." You decide what to do about it.

The pipeline re-runs over time. Pre-tour research runs weeks ahead. A
refresh runs the week of arrival. The public Atlas stays current as the
pipeline keeps discovering.

### How It Fits

- **The Connecting America Tour** is the primary consumer during production.
  The Atlas is how the producer finds the people worth talking to.

- **The Rebuilding America website** hosts the public Atlas. Viewers go from
  watching content to finding the people and organizations doing the work.

- **Project Lovelace** integrates with the Atlas via API. The civic
  engagement app connects users to action; the Atlas provides the map
  of who's doing that work and where.

- **The series issues guide** is the source of the issue taxonomy that
  the Atlas tags against. As the guide evolves, the taxonomy evolves.

### What Gets Built and When

**Phase 1: The pipeline.**
Autodiscovery end-to-end. Query generation, source fetching, AI extraction,
dedup, ranking, gap analysis. Minimal storage and triage interface. Done when
you can type a city, select issue areas, and get back real entries with
source links.

**Phase 2: The internal interface.**
Production-facing tool for searching, filtering, and managing entries.
Contact tracking, outreach logging, tour route integration.

**Phase 3: The public Atlas.**
Public-facing browse and search. Source-attributed entries. Embeddable on
the Rebuilding America website. API for Lovelace integration.
