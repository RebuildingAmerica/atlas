# Follow, Watch, And Personal Civic Home PRD

Status: Draft
Date: 2026-07-03
Owner: Rebuilding America Project

## User Outcome

A user can follow people, organizations, places, issues, and directories they
care about, then return to a calm personal civic home that highlights meaningful
source-backed changes without creating surveillance dynamics.

## Problem

Civic discovery should not end after one search. Users need lightweight ways to
keep track of actors, places, and issues. But monitoring named people can become
creepy or dangerous if designed like an intelligence dashboard. Atlas needs a
high-signal, safety-aware follow and watch model.

## Users

- Public user following a local issue.
- Viewer following an episode topic.
- Civic actor following their own profile or field.
- Journalist or creator watching a beat.
- Workspace user monitoring a research list or coverage target.

## Core Requirements

1. Follow actions
   - Public users can follow a profile, place, issue, directory, or show topic
     after sign-in.
   - Follow buttons live on profiles, place pages, issue pages, directories,
     collections, and search results.

2. Personal civic home
   - Shows followed places, issues, actors, directories, and show topics.
   - Highlights meaningful changes since last visit.
   - Offers continue-search and source-submission paths.
   - Avoids dense dashboard framing.

3. Change summaries
   - New source-backed profile.
   - New source for followed profile.
   - Claim or correction status changed.
   - Stale profile refreshed.
   - New related actor in followed place or issue.
   - Directory coverage changed.

4. Digest controls
   - User chooses in-app only or email when email is available.
   - User chooses frequency.
   - User can mute actors, places, issues, and directories.
   - User can unfollow from any digest item.

5. Workspace watch
   - Team workspaces can watch lists, coverage targets, briefs, places, and
     issues.
   - Workspace watches are separated from personal follows.
   - Person-focused monitoring can require stricter governance.

## UX Requirements

- Use "follow" for public lightweight interest and "watch" for workspace
  research monitoring.
- Do not show a wall of low-signal events.
- Every update links to sources or changed claims.
- Let users tune frequency without complex settings.
- Keep personal home friendly and uncluttered.
- Do not use surveillance language.

## Data And Interfaces

Follow target:

- User id.
- Target type.
- Target id.
- Notification preference.
- Created timestamp.
- Muted state.

Change event:

- Event id.
- Target type and id.
- Event type.
- Summary.
- Linked source ids.
- Linked claim ids.
- Trust state.
- Created timestamp.
- Visibility scope.

Digest:

- User or workspace id.
- Target set.
- Time window.
- Ranked events.
- Delivery state.
- Preference snapshot.

## Safety And Privacy

- Public follows do not expose private interest lists by default.
- Monitoring individual people has stricter thresholds than monitoring places,
  issues, organizations, initiatives, or directories.
- Updates must be source-backed or explicitly administrative, such as claim
  status changed.
- Do not infer private behavior from social activity.
- Workspace watches must not leak private notes into personal digests.

## Metrics

- Follow starts.
- Return visits from followed items.
- Digest open rate.
- Unfollow and mute rate.
- Source inspection from change summaries.
- Reported harmful or noisy updates.
- Workspace watch-to-brief or watch-to-list actions.

## Acceptance Criteria

- A signed-in user can follow a profile, place, issue, and directory.
- Personal home shows followed items and meaningful changes.
- Every change summary links to source, claim, profile, or directory context.
- Users can mute or unfollow from digest items.
- Workspace watches stay separate from personal follows.
- Person-focused monitoring follows governance restrictions.
