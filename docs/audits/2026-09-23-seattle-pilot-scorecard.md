# Seattle pilot: public discovery scorecard

September 23, 2026 · read-only production API and public-source review

## Decision

**Seattle transportation is a candidate for a narrow, reviewed pilot; Seattle
housing and a promise to find individual organizers are not ready to promote.**
This is a supply and task-fit assessment, not release acceptance. The deployed
app does not contain this branch's interface and trust fixes, and no signed-in
save, support, correction, or payment journey was exercised.

The public
[Seattle catalog query](https://atlas-api.rebuildingus.org/api/entities?city=Seattle&state=WA&limit=100)
returned 24 organizations and no people. Seven carried the
`transportation_and_mobility` tag. Four carried `public_transit`. Fourteen
carried `housing_affordability`, but eleven of those fourteen have only filing
prose and no listed website. These are observed record properties, not a
judgment that the organizations themselves are inactive or unreachable.

## Ten visitor questions

Each result count is from `GET /api/entities` with `city=Seattle`, `state=WA`,
and the listed extra parameters. “Useful” means an initial card supplies
specific work and an official next step; it does **not** mean all profile claims
have passed editorial verification. Query terms use the public API's text
filter, not a claimed end-to-end natural-language-search result.

| Visitor question                                | Extra filter                                     | Results | Initial task outcome                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------ | ------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who advocates for public transit?               | `issue_area=public_transit`                      |       4 | Four plausible groups: Seattle Subway, Transportation Choices Coalition, Transit Riders Union, and SmarterTransit. Each lists a website; review specific current claims and source dates before promotion.                                                                       |
| Who organizes transit riders?                   | `query=riders`                                   |       2 | Transit Riders Union directly answers this; Transportation Choices Coalition is relevant advocacy but should not be described as rider-led from this result alone.                                                                                                               |
| Who works on bike safety?                       | `query=bike`                                     |       3 | Washington Bikes and Seattle Streets Alliance are plausible. Cascade Bicycle Club is missing despite its official Seattle bike-safety work; “bike” does not find “bicycle.”                                                                                                      |
| Who works on safer walking?                     | `query=walk`                                     |       2 | Seattle Streets Alliance is directly relevant. The second result needs a claim-level check for the requested work.                                                                                                                                                               |
| Which groups work across transportation?        | `issue_area=transportation_and_mobility`         |       7 | Seven plausible organization profiles with websites. This broad query has enough candidate supply for editorial review, though several are statewide or regional rather than Seattle-only.                                                                                       |
| Who works on affordable housing?                | `issue_area=housing_affordability`               |      14 | Two cards clearly explain work and offer a website: Washington Low Income Housing Alliance and Tenants Union. Washington Community Action Network has a website but its card leads with a tax-deductibility disclaimer; eleven others are filing-style entries without websites. |
| Who helps tenants organize?                     | `query=tenant`                                   |       1 | Tenants Union is directly useful. The query offers no depth if that result is unavailable or unsuitable.                                                                                                                                                                         |
| Who works on housing insecurity?                | `issue_area=homelessness_and_housing_insecurity` |       3 | Housing Alliance and Tenants Union offer useful initial paths. WashingtonCAN needs a work-focused description and source review.                                                                                                                                                 |
| Which housing groups advocate on policy?        | `query=policy&issue_area=housing_affordability`  |       0 | Search misses the Housing Alliance despite its published 2026 policy agenda. The catalog does not answer this reasonable wording.                                                                                                                                                |
| Which individual transit organizers can I find? | `entity_type=person&issue_area=public_transit`   |       0 | Do not promise a people-finding outcome for this promoted slice.                                                                                                                                                                                                                 |

The [Cascade Bicycle Club advocacy page](https://cascade.org/outreach-advocacy)
describes current Seattle bike-network work, while its Atlas description uses
“bicycling” and its official site is listed. The
[Housing Alliance's 2026 agenda](https://www.wliha.org/2026agenda) describes
affordable-housing and homelessness policy work that `query=policy` failed to
surface. Those are concrete retrieval misses, not just missing records.

## Source and profile review

Ten Seattle records with listed websites and transportation or housing tags were
opened through the public detail API. Washington Bikes, Washington Low Income
Housing Alliance, Cascade Bicycle Club, Seattle Streets Alliance, Seattle
Subway, Transportation Choices Coalition, Washington Community Action Network,
Transit Riders Union, SmarterTransit, and Tenants Union each had a public
official-site URL in Atlas. Their Atlas source artifacts were mostly an
organization homepage plus an IRS-filing link, or one homepage. None of those
ten source artifacts had a published date in the API response. Transit Riders
Union's two listed sources were `www.transitriders.org` and `transitriders.org`,
the same publisher in two URL forms. A count of two must not be presented as
independent corroboration.

Primary-site spot checks support the existence and broad work of
[Seattle Subway](https://www.seattlesubway.org/aboutus/),
[Transit Riders Union](https://transitriders.org/),
[Transportation Choices Coalition](https://transportationchoices.org/about/),
[Cascade Bicycle Club](https://cascade.org/who-we-are), and the
[Tenants Union](https://tenantsunion.org/). They do not certify every sentence,
address, current campaign, or contact route in Atlas. The linked Atlas homepages
are not yet claim-level evidence for the specific statements a visitor might use
in an outreach brief.

## Release work this exposes

1. **Choose the promise:** start with “find Seattle-area transportation
   organizations and inspect their official work,” subject to a human review of
   the seven candidates. Use “listed in Seattle” where city is an address, not
   proof of service geography. Do not advertise Seattle housing or individual
   organizers as equally complete.
2. **Review the seven transportation profiles:** confirm identity, current
   activity, Seattle relevance, official next step, and at least one specific
   source for each promoted claim. Record a reviewer and review date. Resolve
   the duplicated Transit Riders Union source and undated-source presentation.
3. **Fix task retrieval:** make “bike” find Cascade Bicycle Club and “housing
   policy” find the Housing Alliance without introducing irrelevant matches.
   Rerun these ten questions against the deployed candidate after the change.
4. **Keep filler out of promoted housing results:** replace filing-only prose
   with reviewed work and a usable contact path, or narrow the housing promise.
   Do not convert an IRS classification into a claim about active organizing.
5. **Prove the full visitor journey:** use a phone and keyboard on the exact
   deployed build to search, choose a record, open a source, follow an official
   next step, and submit a correction. Record observed outcomes, not only HTTP
   success or test results.

This scorecard is the first reproducible slice of the ten-question gate in the
[launch execution status](2026-09-23-launch-execution-status.md). It is not an
editorial sign-off or evidence of a staffed support process.
