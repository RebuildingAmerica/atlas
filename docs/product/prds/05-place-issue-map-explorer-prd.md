# Place, Issue, And Map Explorer PRD

Status: Draft
Date: 2026-07-03
Owner: Rebuilding America Project

## User Outcome

A user can understand who is doing civic work in a place or around an issue,
switch between map and list views, see what coverage is strong or sparse, and
inspect source-backed profiles without losing context.

## Problem

Maps can easily become impressive but unusable. Atlas needs a place and issue
explorer that makes geography legible without hiding the list, evidence, or
coverage caveats that make the information trustworthy.

## Users

- Public visitor exploring a city, region, state, or district.
- Viewer following an episode topic.
- Organizer looking for nearby allies.
- Journalist or researcher scanning a local landscape.
- Workspace user converting an ecosystem view into a list, watch, or brief.

## Core Requirements

1. Place pages
   - Show place name, parent places, summary, issue coverage, actor counts,
     source freshness, and related places.
   - Include search within the place.
   - Link to issue-filtered place views.

2. Issue pages
   - Show issue name, plain-language definition, related issues, actor counts,
     source freshness, and high-signal places.
   - Include search within the issue.
   - Link to place-filtered issue views.

3. Map/list parity
   - Every map result exists in the list.
   - Every list result can be located or described geographically.
   - Users can use the product without the map.

4. Map markers and clusters
   - Mark actor type and confidence state without relying on color alone.
   - Cluster dense results.
   - Avoid false precision for people and sensitive entities.
   - Mark approximate geography when exact location is not appropriate.

5. Coverage truth
   - Show source density, coverage gaps, stale areas, and thin evidence.
   - Do not present sparse coverage as comprehensive.
   - Let users submit sources from gap states.

6. Context panels
   - Clicking a map marker opens a compact profile preview.
   - The preview includes trust summary, issue labels, place, and actions.
   - Users can open the full profile without losing the explorer context.

## UX Requirements

- Default to the simplest useful geography.
- Keep filters stable while switching between list and map.
- Use breadcrumbs for place hierarchy.
- Keep legends small, persistent, and plain.
- Make "approximate" and "source-backed" visible.
- Avoid dense dashboards, heatmap clutter, and decorative map layers.
- Support keyboard navigation in list mode.

## Data And Interfaces

Place summary:

- Place id and slug.
- Display name.
- Place type.
- Parent and child places.
- Actor counts by type.
- Issue counts.
- Source count.
- Latest source date.
- Coverage state.
- Related places.

Issue summary:

- Issue id and slug.
- Display label.
- Plain definition.
- Related issue ids.
- Actor counts.
- High-signal places.
- Source count.
- Latest source date.

Map result:

- Entity id.
- Actor type.
- Coordinates or approximate geography.
- Precision state.
- Trust summary.
- Preview fields.
- Linked profile URL.

## Safety And Privacy

- Person profiles default to approximate geography unless public sources justify
  a specific public office, event, or organization location.
- Sensitive actor categories can appear in list-only or approximate mode.
- Map clustering must not expose hidden sensitive locations through zoom
  behavior.
- Coverage gap states should invite source contribution, not speculative
  conclusions about absence.

## Metrics

- Place page to profile open rate.
- Issue page to profile open rate.
- Map/list toggle use.
- Source submission from gap states.
- Mobile explorer completion rate.
- Percentage of map results with precision labels.

## Acceptance Criteria

- A user can browse a place and filter by issue.
- A user can browse an issue and filter by place.
- Map and list views show the same result set.
- Approximate geography is visibly labeled.
- Sparse, stale, and strong coverage states are distinct.
- Users can inspect sources and open profiles from the explorer.
