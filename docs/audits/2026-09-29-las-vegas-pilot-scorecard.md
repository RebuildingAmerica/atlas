# Las Vegas pilot scorecard

Opened September 29, 2026 · status **baseline only: no reviewed Las Vegas record
is published yet**

This scorecard runs the ten visitor questions from the
[editorial packet](2026-09-27-las-vegas-editorial-packet.md) against the
deployed Atlas, on a 390 × 844 phone viewport in the browser and then on a real
phone. Each row names the release it ran against. A question passes when it
returns at least three relevant reviewed results with a working official next
step, or when the product states its narrower coverage accurately.

## Method

For each question:

1. Type the search a visitor would type on `/browse` (listed below).
2. Count the relevant reviewed results on the first screen.
3. Open one result, open its cited source, and follow its official action.
4. For question 10, submit a correction and follow the report's status page.
5. Record pass, narrowed, or fail, and any step where the visitor would
   hesitate.

"Reviewed" means the profile shows "Reviewed by an Atlas editor" in its record
history. City boards and committees that happen to carry an issue tag are not
counted as answers.

## Promise for this pilot

- **Housing (questions 5, 7, 8):** promoted if each returns three relevant
  reviewed organizations with working official actions.
- **Transit (questions 1, 2):** one reviewed rider-advocacy group exists. Atlas
  says its coverage is still growing when a search reaches the end of its
  results. Transit is described as one reviewed rider-advocacy group, not a
  directory.
- **Bicycling, pedestrian safety, eviction help (questions 3, 4, 6):** one
  reviewed answer each at most. Not promoted.
- **Individual organizers (question 9):** no people are proposed. Atlas must not
  present anyone as an organizer to contact.
- **Corrections (question 10):** promoted when the hosted report, review,
  disposition, and status journey passes.

## Questions

| #   | Visitor question                                                    | Search typed                   | Baseline, `v2026.09.28-4` (Sept 28)          | After publication |
| --- | ------------------------------------------------------------------- | ------------------------------ | -------------------------------------------- | ----------------- |
| 1   | Who can I join to advocate for better buses in the Valley?          | `transit in Las Vegas`         | 0 results                                    | Pending           |
| 2   | Who is pushing for transit funding and land-use change?             | `public transit Las Vegas`     | 4 city boards, no actions                    | Pending           |
| 3   | Who advocates safer bicycling in Southern Nevada?                   | `bicycle Las Vegas`            | 0 results                                    | Pending           |
| 4   | Where can I learn about pedestrian safety locally?                  | `pedestrian safety Las Vegas`  | 0 results                                    | Pending           |
| 5   | Which groups organize or advocate for tenants and housing justice?  | `tenant organizing Las Vegas`  | 3 city boards + NAACP branch, no actions     | Pending           |
| 6   | Which group can help me with an eviction or tenant-rights question? | `eviction help Las Vegas`      | 0 results                                    | Pending           |
| 7   | Which Nevada groups work on affordable-housing policy?              | `affordable housing Nevada`    | Same 4 records                               | Pending           |
| 8   | How can I take part in local housing work?                          | `housing Las Vegas`            | Same 4 records                               | Pending           |
| 9   | Which individual Las Vegas housing organizers should I contact?     | `housing organizers Las Vegas` | 0 people                                     | Pending           |
| 10  | How do I correct an inaccurate Atlas profile?                       | Report link on any profile     | Report flow existed; no reporter status page | Pending           |

## Accessibility and performance

| Check                                                                                                                                              | Result                                                                | Release                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------- |
| Automated WCAG 2.1 AA (axe) on Browse, profile, correction form, receipt, report status, sign-up, check-inbox, save dialog, list detail, workspace | 0 violations after fixing 197 contrast failures and 12 untitled pages | Local acceptance on `main` at `f3e9ad94` |
| Keyboard-only: search → profile → source → action → report                                                                                         | Pending                                                               |                                          |
| VoiceOver on a real phone, same path                                                                                                               | Pending (operator)                                                    |                                          |
| Reflow at 320px and 200% zoom                                                                                                                      | Pending                                                               |                                          |
| Lighthouse mobile: `/browse`, one profile, `/feedback/<slug>`                                                                                      | Pending                                                               |                                          |
