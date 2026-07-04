# Research Runs To Briefing Room PRD

Status: Draft
Date: 2026-07-03
Owner: Rebuilding America Project

## User Outcome

A researcher, journalist, creator, or civic team can turn a place, issue, or
actor question into a source-linked research output, inspect the evidence, save
useful actors, and produce a brief without losing trust context.

## Product Position

Research runs and briefs are important paid and professional workflows, but they
serve public civic discovery. They should make Atlas better at finding and
explaining source-backed civic information, not pull the product into a generic
enterprise research dashboard.

## Users

- Reporter or producer preparing a story.
- Organizer scoping a place or issue.
- Foundation or nonprofit researcher.
- Rebuilding America producer.
- Atlas research operator.
- Workspace reviewer or editor.

## Core Requirements

1. Research request
   - User defines place, issue, actor type, source type, time window, and goal.
   - The form uses plain research language.
   - Existing public profiles and sources can seed the request.

2. Research run summary
   - Show ranked leads, key sources, gaps, and trust context.
   - Make reasoning inspectable through evidence and source receipts.
   - Avoid pipeline-log presentation.

3. Source packet
   - Group sources by actor, issue, place, and claim.
   - Show source metadata, freshness, and review state.
   - Let users open original sources.

4. Gap analysis
   - State missing or weak coverage plainly.
   - Offer next research paths, source submission, or coverage target creation.
   - Do not imply absence means no civic work exists.

5. Save and handoff
   - Save actors to list.
   - Convert run summary to brief.
   - Export source-linked evidence pack.
   - Watch actors, places, or issues when authorized.

6. Briefing Room
   - Brief reads like a source-linked memo.
   - First screen shows scope, summary, trust state, known gaps, and next
     actions.
   - Export as JSON, CSV, and print/PDF-friendly view with receipts.

## Data And Interfaces

Research request:

- Workspace id.
- Requesting user id.
- Place scope.
- Issue scope.
- Actor type filters.
- Source type filters.
- Time window.
- Research goal.
- Seed profile, source, list, or directory ids.

Research run output:

- Run id.
- Scope.
- Ranked leads.
- Key sources.
- Evidence pack.
- Gap summary.
- Confidence summary.
- Suggested next actions.
- Created brief id when saved.

Brief:

- Brief id.
- Workspace id.
- Title.
- Scope.
- Summary.
- Linked profiles.
- Linked sources.
- Linked discovery runs.
- Known gaps.
- Confidence summary.
- Export history.

## UX Requirements

- Research forms should be short and progressive.
- The run output should feel like a useful result, not a status dashboard.
- Users can inspect sources before saving or exporting.
- Brief creation should preserve scope and evidence automatically.
- Print/PDF layouts must keep source receipts attached.
- Workspace-only actions are available but secondary to understanding the
  research output.

## Safety And Governance

- Requests involving vulnerable people, sensitive issues, or person monitoring
  can require review.
- Exports must preserve evidence and confidence metadata.
- Briefs must not recommend harassment, exposure, intimidation, or targeting.
- Campaign and political uses stay within public-source civic landscape
  intelligence.

## Metrics

- Research request completion rate.
- Run-to-profile-open rate.
- Run-to-source-inspection rate.
- Run-to-brief conversion rate.
- Brief export rate.
- Gap-to-next-action rate.
- Correction rate on research outputs.

## Acceptance Criteria

- A workspace user can create a research request from place plus issue.
- Run output includes leads, sources, gaps, and confidence summary.
- Users can inspect evidence behind run results.
- Users can save actors to a list and convert output to a brief.
- Brief export preserves source receipts and trust metadata.
- Restricted research requests are denied or routed to review with plain copy.
