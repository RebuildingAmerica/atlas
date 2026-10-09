# Merging duplicate profiles

Status, 2026-10-09: v1 built as described below. The last editorial feature in
I7 of the admin separation plan. Self-hostable: it lives in the end app under
the instance-operator role, like takedowns.

## Why this exists

Discovery sometimes creates the same person or organization twice: a nickname, a
renamed group, a chapter listed under its parent's name. A visitor then finds
two half-profiles, each with some of the sources, and cannot tell which is
right. Followers and saved lists split between them. Two profiles for one actor
is wrong data shown confidently, which is the experience failure Atlas exists to
avoid. Today the only remedy is SQL.

## What the editor sees

A Merge page in `/editorial`. The editor pastes two profile addresses: the one
to keep and the duplicate. Atlas shows both side by side and what will move:
sources, issue areas, connections, followers, saved-list places, open reports
and identity keys. It also lists anything that blocks the merge. The editor
gives a reason and confirms. Afterwards:

- The duplicate's address opens the kept profile, so shared links still work.
- The kept profile has every source either one had, so its facts are better
  supported, not worse.
- Followers of either follow the kept profile; saved lists hold it once.
- Discovery that finds the duplicate again matches the kept profile, because the
  identity keys moved with it.
- The merge appears in editorial activity with its reason, and on the Merge
  page's list of past merges.

The kept profile's own facts (name, description, website, place) do not change.
Atlas does not guess which description is better; the editor corrects facts
afterwards with the existing profile correction flow, which goes through review
like any other change.

## Blocked merges

Atlas refuses, and says why, when:

- the two are the same profile, or of different types;
- either was already merged away;
- either is taken down (restore it first, or merging would reveal it);
- either is private to a workspace rather than in the public catalog;
- the duplicate has a pending or verified representative (merge the other way,
  so the person who verified keeps their profile);
- both have a linked ATProto account (a profile holds one).

## What moves

All in one transaction; a failure leaves both profiles untouched.

| Table                                                                | On merge                                                                                                                                      |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `entry_sources`, `entry_issue_areas`, `episode_associations`         | Moved unless the kept profile already has the row                                                                                             |
| `profile_follows`, `saved_list_items`, `org_coverage_target_entries` | Moved unless already present (one follow, one saved place)                                                                                    |
| `entity_relationship_edges`                                          | Repointed; edges between the two, or duplicating an existing edge, are dropped                                                                |
| `entity_identity_keys`                                               | Moved, so discovery dedups onto the kept profile                                                                                              |
| `entity_flags`                                                       | Open reports move; closed ones stay as history                                                                                                |
| `review_queue`                                                       | Pending items on the duplicate are rejected with the merge as the reason; their facts were proposed for a profile that no longer stands alone |
| `profile_atproto_links`                                              | Moved when only the duplicate has one                                                                                                         |
| `outreach_logs`, `org_annotations`, `org_change_events`              | Repointed, so a workspace's notes follow the actor                                                                                            |
| `entries.affiliated_org_id`                                          | People affiliated with a merged organization point at the kept one                                                                            |
| `slug_aliases`                                                       | The duplicate's slug, and any aliases it had, resolve to the kept profile                                                                     |
| `profile_claims`                                                     | Rejected and withdrawn claims stay on the duplicate as history                                                                                |
| `entries` (the duplicate)                                            | Set inactive, never deleted                                                                                                                   |

`org_briefs.linked_entry_ids_json`, `org_usage_events` and `org_watches` hold
entry ids inside workspace data and are left as written; a brief that links the
duplicate shows it as unavailable. Rewriting workspace documents is not worth
the risk for v1.

A new table
`entry_merges(id, kept_entry_id, duplicate_entry_id, kept_name, kept_slug, duplicate_name, duplicate_slug, reason, merged_by, merged_at, moved_json)`
records each merge and the counts moved. The duplicate's column is unique, and
the row is written before anything moves, so of two concurrent merges of one
duplicate only one runs. The audit log records the decision and its reason like
every editorial action.

A merged duplicate stays retired. A database trigger refuses to publish it
again, as `entries_stay_down` does for takedowns, and discovery that matches the
duplicate's name lands on the kept profile instead, following merges of merges
to the profile that still stands.

## Not doing in v1

Undo (rows have moved; restoring the duplicate is a new profile), merging more
than two at once, merging field values, suggesting duplicates automatically.
Each is its own design once merges are in use.

## API

- `GET /api/merges/preview?keep=&duplicate=` (slugs): both profiles, the counts
  that would move, and blockers. Read-only, so not audited.
- `POST /api/merges` `{keep, duplicate, reason}`: merges, returns the record.
- `GET /api/merges`: past merges, newest first.

All under a new action `instance.entries.merge`, held by instance operators.
