# Workspace For Teams PRD

Status: Draft
Date: 2026-07-03
Owner: Rebuilding America Project

## User Outcome

Small teams can save civic research, make notes, build briefs, track coverage,
and share source-linked outputs without Atlas turning into a heavy enterprise
CRM or cluttering the public discovery experience.

## Product Position

The workspace is a private utility layer for journalists, creators, nonprofits,
coalitions, and civic institutions. It funds and extends Atlas, but it is not
the primary product experience. Public discovery remains the front door.

## Users

- Local journalist or small newsroom.
- Independent creator team.
- Rebuilding America production team.
- Nonprofit research team.
- Coalition or field team.
- Workspace admin.

## Core Requirements

1. Workspace home
   - Shows recent briefs, lists, watches, coverage targets, and saved profiles.
   - Avoids executive dashboard clutter.
   - Provides clear next actions: search, start research, open list, open brief.

2. Saved lists
   - Save profiles from public search, profiles, research runs, and briefs.
   - Add private notes.
   - Export with source and trust metadata.
   - Convert list to watch or brief when authorized.

3. Briefs
   - Create, read, export, print, and share source-linked briefs.
   - Preserve linked profiles, sources, discovery runs, confidence, and gaps.
   - Keep memo reading experience stronger than admin metadata.

4. Coverage
   - Track places, issues, actor types, source freshness, and coverage gaps.
   - Convert gaps to research requests.
   - Show status without implying comprehensive knowledge.

5. Watches
   - Watch actors, places, issues, lists, and coverage targets.
   - Show high-signal changes.
   - Separate team watch from personal follow.

6. Notes and activity
   - Private notes can attach to profiles, lists, briefs, and sources.
   - Activity history helps teams understand recent work.
   - Notes are never public and never exported through public APIs.

7. Administration
   - Member invitations.
   - Roles and permissions.
   - Package capability summary.
   - API keys where authorized.
   - Usage summary for value proof.

## IA Requirements

Workspace navigation:

- Home
- Research
- Briefs
- Lists
- Coverage
- Watching
- Activity
- Organization

Workspace pages must link back to public profiles and sources. Public pages can
show workspace actions only when a signed-in user has access, and those actions
must remain visually secondary.

## Data And Interfaces

Workspace objects:

- Organization.
- Member.
- Role.
- Saved list.
- Private note.
- Brief.
- Coverage target.
- Watch target.
- Usage event.
- Export record.

Capability gates:

- Brief creation.
- Exports.
- Coverage workspace.
- Watch digests.
- API/MCP.
- Admin and billing settings.

## UX Requirements

- Workspace UI should be quiet, dense enough for repeated work, and easy to
  scan.
- Do not use sales package names as primary user navigation.
- Public profile and source links remain canonical.
- Empty states point to useful actions, not internal setup language.
- Exports clearly state what evidence and private notes are included.

## Safety And Privacy

- Private notes and customer artifacts remain private.
- Exports preserve source and confidence metadata.
- Workspace watches follow monitoring restrictions.
- Roles and permissions prevent accidental sharing.
- Customer-specific research context must not leak into public profiles.

## Metrics

- Saved profiles per workspace.
- List-to-brief conversion.
- Brief exports.
- Coverage gaps converted to research.
- Watch digest engagement.
- Workspace retention by role.
- Public profile opens from workspace objects.

## Acceptance Criteria

- A team can save a public profile to a list and add a private note.
- A team can create and export a source-linked brief.
- A team can track coverage targets and convert gaps into research.
- Workspace watches stay private to the workspace.
- Public pages do not show workspace clutter to signed-out users.
- Exports state and preserve evidence metadata.
