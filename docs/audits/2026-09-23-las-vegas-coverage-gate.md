# Las Vegas coverage gate

September 23, 2026 · read-only production API inventory

## Decision

**Do not promote a Las Vegas transit, housing, or people-finding pilot yet.**
Las Vegas is the intended home-market starting point. The current public records
do not let a visitor reliably find a local group, understand its current work,
and reach an official next step. This is a supply and editorial gate, not a
conclusion that relevant Las Vegas organizations do not exist.

The
[city query](https://atlas-api.rebuildingus.org/api/entities?city=Las%20Vegas&state=NV&limit=100)
returned 73 records: 45 people and 28 organizations. None has a listed website
or email; none is marked verified. All 45 people are `partial_actor` and
`unverified` in the response. This snapshot is limited to records whose stored
city is exactly Las Vegas; it does not measure Henderson, North Las Vegas,
unlocated regional groups, or real-world civic activity.

| Visitor intent                     | City records carrying the issue tag | Listed website or email | Product consequence                                                                                                                |
| ---------------------------------- | ----------------------------------: | ----------------------: | ---------------------------------------------------------------------------------------------------------------------------------- |
| Find a public-transit group        |                                   0 |                       0 | The core transit question has no tagged result.                                                                                    |
| Find a transportation group        |                                   3 |                       0 | Two are government advisory bodies; the third is the NAACP branch with many issue tags. None supplies a listed official next step. |
| Find a housing-affordability group |                                   4 |                       0 | The records include public bodies and the NAACP branch, but none supplies a listed official next step.                             |
| Find a housing-insecurity group    |                                   2 |                       0 | Both need current-work, source, and contact review before promotion.                                                               |
| Find an individual organizer       |                     45 people total |                       0 | The sample is elected legislators with sparse role descriptions; the count does not establish an organizer-finding experience.     |

The
[state query](https://atlas-api.rebuildingus.org/api/entities?state=NV&limit=100)
returned 75 records, only two more than the city query. Broadening to Nevada
does not currently repair the local transit/housing supply gap. These numbers
are a point-in-time API observation, not claim-level validation.

Detail responses for all 28 city organizations showed that 27 had one HTTPS
source labeled `org_website`. Most of those source URLs were shared city or
county boards directories, not a group's own contact site. Excluding URLs linked
to more than one profile leaves two possible website reviews:
[Faith Organizing Alliance](https://www.faithorganizingalliance.org) and
[NAACP Las Vegas Branch #1111](https://www.naacplasvegas.org/about). These are
review candidates only. A person must check present ownership, current work, and
the appropriate public action before either becomes a contact link.

## Work that changes this decision

1. Use Las Vegas visitor questions as the acquisition brief: who organizes
   transit riders, who advocates safer walking and biking, who works with
   tenants, and who can a resident contact or join? Inventory the actual
   organizations and people serving the valley, including neighboring cities,
   before choosing promoted query terms.
2. For each candidate, record an official source for identity, current work,
   service area, and a public next step. Resolve duplicates and distinguish
   elected officeholders, government advisory bodies, and independent
   organizers. A filing or broad issue tag cannot substitute for this review.
3. Publish only reviewed facts and contact routes. Re-run ten Las Vegas visitor
   questions on the deployed candidate. Promote only questions with at least
   three relevant, source-supported results and a usable official next step;
   narrow the promise when fewer exist.
4. Have a real visitor complete search → profile → source → official action →
   correction on a phone, with a named editor and support owner available to
   handle mistakes. Record the observed result and review date.

The [Seattle scorecard](2026-09-23-seattle-pilot-scorecard.md) remains a
comparative data-quality observation. It is not the default pilot decision or a
substitute for building the Las Vegas experience.
