# Las Vegas review record

Prepared September 28, 2026 · status **proposed — nothing here is approved or
published**

This record is what the Atlas editor reads before staging and approving each Las
Vegas candidate. It replaces the proposals in the
[editorial packet](2026-09-27-las-vegas-editorial-packet.md) with a
field-by-field check against each organization's own pages, rechecked on
September 28, 2026. After approval, each section gains the reviewer and time
recorded by the review queue, and a link to the published profile.

Atlas is run by one person, who prepares, stages, and approves these records.
There is no second reviewer. Where the reviewer has a personal interest, the
section says so first.

## How to read a section

- **Form values** are exactly what goes into `/admin/discovery-reviews`
  (Editorial candidate form) or, for an existing profile, the Editorial profile
  correction form. The intake requires the action link to be on the same site as
  the source link.
- **Claim support** pairs each public claim with the page that supports it and
  the date the page shows. "Undated" means the page carries no date; the check
  date is then the only freshness evidence.
- **Open checks** must be cleared by the editor before approving.

## Scope decisions

- **Transit.** A search on September 28 found one rider-centered transit
  advocacy group in the Las Vegas Valley: Las Vegans for Better Transit. The
  Nevada Rail Coalition's site no longer resolves. The Maryland Parkway
  Coalition is a corridor district coalition, not a rider group. The Southern
  Nevada Bicycle Coalition and PedSafe Vegas have different roles. Atlas will
  describe its Las Vegas transit coverage as one reviewed rider-advocacy group,
  not a directory.
- **Housing.** Four organizations with different roles: two statewide coalitions
  (Nevada Housing Justice Alliance, Nevada Housing Coalition), one member-led
  organizing group with Las Vegas offices (Make the Road Nevada), and one legal
  service provider (Legal Aid Center of Southern Nevada). Plus the existing
  NAACP Las Vegas Branch record, whose Housing Committee is documented.
- **People.** No individual organizer is proposed. A committee page naming a
  chair is not permission to present that person as a contact.
- **Held.** PedSafe Vegas is a program of UNLV's Transportation Research Center,
  not an independent organization. It stays held until the editor decides
  whether Atlas should profile the program or its parent.

## Duplicate checks

Completed before this record (see the packet's September 28 recheck): no exact
name match among 1,403 published records; no candidate domain in any published
contact website or action URL; only `naacplasvegas.org` matched a linked source.

1. **Fuzzy name sweep — done September 28 against all 1,403 published records.**
   A record was flagged if its name was at least 80% similar, if its website or
   action link used a candidate's domain, or if it was a Nevada record sharing a
   distinctive word. No candidate matched on similarity or domain. Three Nevada
   records were flagged on a shared word and are different entities: Southern
   Nevada Regional Housing Authority (a public housing agency), Juvenile Justice
   Services Citizen Advisory Council, and Sin City Mutual Aid. The closest names
   overall were out-of-state organizations, the nearest at 79% (Austin Housing
   Coalition, for Nevada Housing Coalition).
2. **Still required:** the editor's search of `/admin/discovery-reviews` for
   each name and domain, to catch private held entries and nonpublic aliases the
   public API cannot show.

---

## Checks cleared on October 2, 2026

Claude rechecked every candidate against production `v2026.10.02-2` before the
editor stages them. The editor still opens each source before ticking "sources
checked".

- **All candidates:** every source and action URL in this record answers 200.
  Duplicate check 2: a production name search for each of the seven candidates
  returns no existing record.
- **Southern Nevada Bicycle Coalition:** the About page itself carries the
  mission ("advocate for safer roadways, better trails, and more biking
  opportunities"). The contact page shows no Las Vegas street address, so stage
  it with the region only and no city.
- **Nevada Housing Justice Alliance:** `/join-us` is a public sign-up for the
  coalition's alerts, not a member-organization application, so "Join" is an
  honest action.
- **Legal Aid Center of Southern Nevada:** `/landlordtenant` redirects to an
  Eventbrite page for Ask-A-Lawyer phone consultations, off the source's host.
  Use the tenant-rights page
  (`/practice-areas/consumer-rights-project/tenant-rights`) as the action so the
  button stays on lacsn.org and does not depend on an event listing.

## 1. Las Vegans for Better Transit — new organization

> **Reviewer interest:** the Atlas operator founded Las Vegans for Better
> Transit (April 2026). This record was held to the same source standard as
> every other, and makes no claim the organization's own pages do not support.

**Form values**

| Field          | Value                                                                                                                                                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name           | Las Vegans for Better Transit                                                                                                                                                                                                                                     |
| Description    | A Las Vegas Valley 501(c)(3) that advocates for better public transportation and supportive land-use policy through education, community outreach, and coalition building. Membership is free, and it recruits volunteers for events, policy, and technical work. |
| State          | NV                                                                                                                                                                                                                                                                |
| Geography      | regional · city Las Vegas · region Las Vegas Valley                                                                                                                                                                                                               |
| Issues         | `public_transit`, `transportation_and_mobility`, `zoning_and_land_use`                                                                                                                                                                                            |
| Source URL     | https://lasvegasfortransit.org/about/                                                                                                                                                                                                                             |
| Source context | About page: mission of public transportation and supportive land-use policy for the Las Vegas metro; 501(c)(3); founded April 2026.                                                                                                                               |
| Action URL     | https://lasvegasfortransit.org/join/ (free membership)                                                                                                                                                                                                            |

**Claim support**

| Claim                            | Page    | Supporting phrase                                                    | Page date                       |
| -------------------------------- | ------- | -------------------------------------------------------------------- | ------------------------------- |
| Transit and land-use advocacy    | /about/ | "world-class public transportation and supportive land use policies" | Undated; founded April 17, 2026 |
| Las Vegas Valley scope           | /about/ | "Las Vegas metropolitan area"                                        | Undated                         |
| 501(c)(3)                        | /about/ | EIN listed                                                           | Undated                         |
| Free membership, volunteer roles | /join/  | Free membership; four named volunteer roles                          | Undated                         |

**Open checks:** duplicate check 2.

## 2. Southern Nevada Bicycle Coalition — new organization

**Form values**

| Field          | Value                                                                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name           | Southern Nevada Bicycle Coalition                                                                                                                                                                                                                      |
| Description    | A Southern Nevada bicycle advocacy group working for safer roadways, better trails, and more biking opportunities, including public safety campaigns with regional partners. Joining is free. It is a cycling group, not a transit-rider organization. |
| State          | NV                                                                                                                                                                                                                                                     |
| Geography      | regional · city Las Vegas · region Southern Nevada                                                                                                                                                                                                     |
| Issues         | `transportation_and_mobility`                                                                                                                                                                                                                          |
| Source URL     | https://www.snvbc.org/about-us/                                                                                                                                                                                                                        |
| Source context | About page: bicycle advocacy for safer roadways, better trails, and more biking opportunities in Southern Nevada.                                                                                                                                      |
| Action URL     | https://www.snvbc.org/join-for-free/                                                                                                                                                                                                                   |

**Claim support**

| Claim                          | Page            | Supporting phrase                                              | Page date |
| ------------------------------ | --------------- | -------------------------------------------------------------- | --------- |
| Bicycle advocacy               | homepage        | "safer roadways, better trails, and more biking opportunities" | Undated   |
| Safety campaigns with partners | homepage        | Named campaigns; RTC and NDOT listed as partners               | Undated   |
| Free to join                   | /join-for-free/ | Page title                                                     | Undated   |

**Open checks:** confirm the About page (not only the homepage) carries the
mission text; confirm a Las Vegas base on `/contact-us/` before using city Las
Vegas, otherwise use region only; duplicate check 2.

## 3. Nevada Housing Justice Alliance — new statewide coalition

**Form values**

| Field          | Value                                                                                                                                                                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name           | Nevada Housing Justice Alliance                                                                                                                                                                                                                                                                     |
| Description    | A statewide Nevada coalition, formed in 2020, of member organizations that works with tenants to advocate for housing solutions and community investment against housing insecurity. Members include unions, advocacy groups, and service organizations. It works statewide, not only in Las Vegas. |
| State          | NV                                                                                                                                                                                                                                                                                                  |
| Geography      | statewide                                                                                                                                                                                                                                                                                           |
| Issues         | `housing_affordability`, `homelessness_and_housing_insecurity`                                                                                                                                                                                                                                      |
| Source URL     | https://www.nvhousingjustice.org/about-us                                                                                                                                                                                                                                                           |
| Source context | About page: statewide tenant-focused coalition founded in early 2020; lists its eleven member organizations and a coalition coordinator.                                                                                                                                                            |
| Action URL     | https://www.nvhousingjustice.org/join-us                                                                                                                                                                                                                                                            |

**Claim support**

| Claim                     | Page      | Supporting phrase                         | Page date                |
| ------------------------- | --------- | ----------------------------------------- | ------------------------ |
| Tenant housing advocacy   | /about-us | "housing is a human right"                | Undated                  |
| Statewide coalition, 2020 | /about-us | Founded early 2020; eleven members listed | Undated                  |
| Current work              | homepage  | "Fee Protections 2025" (AB121) section    | 2025 legislative session |

**Open checks:** open `/join-us` and confirm it is a working way to join or
contact (the packet warned not to promise an open membership form — if it is a
coalition-member application, label the action "Contact" and use `/take-action`
or the About page instead); duplicate check 2.

## 4. Make the Road Nevada — new organization

**Form values**

| Field          | Value                                                                                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name           | Make the Road Nevada                                                                                                                                                                                                                                                |
| Description    | A member-led 501(c)(3) that organizes Latine, immigrant, and working-class communities of color through organizing, policy work, and education, including housing justice and bilingual affordable-housing resources. It has two Las Vegas offices and one in Reno. |
| State          | NV                                                                                                                                                                                                                                                                  |
| Geography      | statewide                                                                                                                                                                                                                                                           |
| Issues         | `housing_affordability`, `immigration_and_belonging`                                                                                                                                                                                                                |
| Source URL     | https://www.maketheroadnv.org/                                                                                                                                                                                                                                      |
| Source context | Homepage: member-led nonprofit using organizing, policy innovation, and education; housing justice named; Las Vegas and Reno offices listed.                                                                                                                        |
| Action URL     | https://www.maketheroadnv.org/contact-us (label: Contact)                                                                                                                                                                                                           |

**Claim support**

| Claim                 | Page     | Supporting phrase                                             | Page date             |
| --------------------- | -------- | ------------------------------------------------------------- | --------------------- |
| Member-led organizing | homepage | "organizing, policy innovation, and transformative education" | Undated; founded 2017 |
| Housing work          | homepage | "housing justice"; "bilingual affordable housing resources"   | Undated               |
| Las Vegas offices     | homepage | Two Las Vegas street addresses                                | Undated               |

**Open checks:** keep the action label "Contact" unless the editor verifies a
more specific housing route; duplicate check 2.

## 5. Legal Aid Center of Southern Nevada — new service organization

**Form values**

| Field          | Value                                                                                                                                                                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name           | Legal Aid Center of Southern Nevada                                                                                                                                                                                                                                                                                                                    |
| Description    | A Clark County legal services provider. Its tenant-rights services include an eviction-prevention hotline, an online eviction-sealing clinic, free weekly phone consultations with volunteer lawyers for tenants without a lawyer, and self-help forms. It provides legal help, not tenant organizing, and does not promise to represent every caller. |
| State          | NV                                                                                                                                                                                                                                                                                                                                                     |
| Geography      | regional · city Las Vegas · region Clark County                                                                                                                                                                                                                                                                                                        |
| Issues         | `housing_affordability`, `homelessness_and_housing_insecurity`                                                                                                                                                                                                                                                                                         |
| Source URL     | https://www.lacsn.org/practice-areas/consumer-rights-project/tenant-rights                                                                                                                                                                                                                                                                             |
| Source context | Tenant Rights page: eviction-prevention hotline, eviction-sealing clinic, Landlord/Tenant Ask-A-Lawyer consultations, self-help center; Las Vegas office.                                                                                                                                                                                              |
| Action URL     | https://www.lacsn.org/landlordtenant (label: Get legal help)                                                                                                                                                                                                                                                                                           |

**Claim support**

| Claim                          | Page          | Supporting phrase                                       | Page date |
| ------------------------------ | ------------- | ------------------------------------------------------- | --------- |
| Eviction and tenant help       | tenant-rights | Hotline, sealing clinic, Ask-A-Lawyer, self-help center | Undated   |
| Clark County, Las Vegas office | tenant-rights | Clark County service; Charleston Blvd office            | Undated   |
| No promise of representation   | —             | The page makes none; the description says so explicitly | —         |

**Open checks:** open `/landlordtenant` and confirm it reaches the Ask-A-Lawyer
signup (otherwise use the tenant-rights page as the action); duplicate check 2.

## 6. Nevada Housing Coalition — new statewide coalition

**Form values**

| Field          | Value                                                                                                                                                                                                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name           | Nevada Housing Coalition                                                                                                                                                                                                                                                                                         |
| Description    | A statewide Nevada membership coalition that promotes the development and preservation of affordable housing through collaboration, education, and policy advocacy, and hosts an annual housing conference. Membership is for organizations and professionals and carries dues; it does not offer eviction help. |
| State          | NV                                                                                                                                                                                                                                                                                                               |
| Geography      | statewide                                                                                                                                                                                                                                                                                                        |
| Issues         | `housing_affordability`                                                                                                                                                                                                                                                                                          |
| Source URL     | https://nvhousingcoalition.org/                                                                                                                                                                                                                                                                                  |
| Source context | Homepage: mission to promote development and preservation of affordable housing for all Nevadans; membership coalition; 2026 Nevada Housing Conference.                                                                                                                                                          |
| Action URL     | https://nvhousingcoalition.org/contact/ (label: Contact)                                                                                                                                                                                                                                                         |

**Claim support**

| Claim                          | Page                                   | Supporting phrase                                                     | Page date |
| ------------------------------ | -------------------------------------- | --------------------------------------------------------------------- | --------- |
| Affordable-housing policy      | homepage                               | "development and preservation of affordable housing for all Nevadans" | Undated   |
| Statewide membership coalition | homepage; /membership/become-a-member/ | Member directory; dues listed                                         | Undated   |
| Current activity               | homepage                               | 2026 Nevada Housing Conference                                        | 2026      |

**Open checks:** the Las Vegas P.O. box does not establish a Las Vegas service
office — keep geography statewide; duplicate check 2.

## 7. NAACP Las Vegas Branch #1111 — correction to the existing profile

Existing record:
`https://atlas-api.rebuildingus.org/api/entities/by-slug/organizations/naacp-las-vegas-branch-1111-c530`.
Its one linked source is the branch About page, so the branch's own pages
qualify as sources for this change. Do **not** create a committee record.

**Current public record (September 28):** 13 issue tags from a single About-page
source; no action URL; description does not mention housing.

**Tag support from the branch's own pages** (`/about`, `/committees`,
`/housing`):

| Tag                                              | Support                                          | Keep?                                    |
| ------------------------------------------------ | ------------------------------------------------ | ---------------------------------------- |
| `housing_affordability`                          | Housing Committee page                           | Keep                                     |
| `criminal_justice_reform_and_mass_incarceration` | "Justice" focus area; Criminal Justice committee | Keep                                     |
| `local_government_and_civic_engagement`          | "Civic Power" focus area; Civic Engagement Lab   | Keep                                     |
| `voter_suppression_and_electoral_access`         | Voter education; Get Out To Vote program         | Keep                                     |
| `environmental_justice_and_pollution`            | Environmental & Climate Change committee         | Keep (committee exists; no program page) |
| `healthcare_access_and_coverage`                 | Health and Wellness committee                    | Keep (committee exists; no program page) |
| `income_inequality_and_wealth_concentration`     | Economic Development committee                   | Keep (committee exists; no program page) |
| `transportation_and_mobility`                    | None found                                       | Remove                                   |
| `broadband_access_and_digital_divide`            | None found                                       | Remove                                   |
| `energy_transition`                              | None found                                       | Remove                                   |
| `mental_health_crisis_and_access`                | None found                                       | Remove                                   |
| `sustainable_agriculture_and_food_systems`       | None found                                       | Remove                                   |
| `water_access_and_infrastructure`                | None found                                       | Remove                                   |

Removing the unsupported transportation tag stops this profile from appearing as
an answer to transit questions it has no evidence for.

**Form values (profile correction)**

| Field                         | Value                                                                                                                                                                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Description                   | A civil rights organization founded in 1928 that organizes members, committees, partners, and volunteers across Las Vegas. Its Housing Committee works on fair housing, discrimination complaints, tenant-rights education, and preventing displacement, and meets monthly.         |
| Issues (full replacement set) | `housing_affordability`, `criminal_justice_reform_and_mass_incarceration`, `local_government_and_civic_engagement`, `voter_suppression_and_electoral_access`, `environmental_justice_and_pollution`, `healthcare_access_and_coverage`, `income_inequality_and_wealth_concentration` |
| Action URL                    | https://www.naacplasvegas.org/housing                                                                                                                                                                                                                                               |
| Cited source                  | https://www.naacplasvegas.org/housing                                                                                                                                                                                                                                               |

**Claim support**

| Claim                  | Page        | Supporting phrase                         | Page date |
| ---------------------- | ----------- | ----------------------------------------- | --------- |
| Housing Committee work | /housing    | "safe, affordable, and equitable housing" | Undated   |
| Monthly meetings       | /housing    | Third Thursday, 6pm                       | Undated   |
| Founded 1928           | /about      | Founding year                             | Undated   |
| Committees             | /committees | Nineteen named committees                 | Undated   |

**Open checks:** the change request replaces the whole tag set, so submit all
seven; the action points to the committee page, never to a person's email.

## 8. PedSafe Vegas — held

A program of UNLV's Transportation Research Center focused on reducing
pedestrian and vulnerable-road-user deaths in Clark County
(https://pedsafe.vegas/). It is presented as a UNLV program, not an independent
organization. Held pending the editor's decision to profile the program, its
parent, or neither. Recommendation: keep held; it would answer only the
pedestrian-safety question, which Atlas will not promote in this pilot.

## Excluded

- **Las Vegas DSA housing campaign** (`lvdsa.org/campaign/housing-justice/`):
  describes a 2021–22 priority with no upcoming events. Research lead only.
- **Nevada Rail Coalition:** site does not resolve (September 28).
- **Maryland Parkway Coalition:** corridor district coalition, not rider
  advocacy; no current official page found.
