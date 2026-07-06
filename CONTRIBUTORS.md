# Contributing To Atlas

Atlas is open to contributors who want to improve civic discovery, source
quality, developer experience, documentation, self-hosting, or responsible data
work.

## Development Philosophy

Atlas is a civic tech codebase. Changes should be:

- **Source-conscious:** Preserve source URLs, excerpts, dates, confidence, and
  correction paths when changing records, APIs, imports, exports, or displays.
- **Useful:** Prefer work that helps someone find, understand, verify, run,
  self-host, or build on Atlas.
- **Small enough to review:** Keep changes focused and explain the practical
  outcome.
- **Respectful of people in the data:** Atlas represents real people and
  organizations, so avoid unsupported claims, private-life inference, and
  source-stripped outputs.

## Getting Started

- Run the project locally with
  [Getting Started](./docs/getting-started/README.md).
- Review the codebase shape in
  [Project Structure](./docs/getting-started/project-structure.md).
- Follow the day-to-day [Development Workflow](./docs/development/workflow.md).
- Check [Standards](./docs/standards/README.md) before opening a code or docs
  change.

## Good First Contributions

- Clarify setup, self-hosting, API, MCP, Scout, or public/private data
  boundaries.
- Report setup gaps with the exact command, environment, expected result, and
  actual result.
- Fix narrow bugs with a clear user or developer outcome.
- Improve data-quality workflows while preserving source evidence and review
  state.

## Before Larger Changes

For deployment, authentication, billing, workspace, API contract, generated
client, or hosted Atlas behavior, read the relevant repo docs first. Those areas
affect the boundary between the open-source project, hosted service, and public
data model.

## Triage And Public Data Safety

Atlas works with public information about real people and organizations. When
reporting problems or proposing changes, include public source links where they
help reviewers verify the claim, but do not post private contact details,
secrets, credentials, unpublished personal information, or sensitive claims that
do not belong in a public GitHub thread.

Security vulnerabilities and sensitive data exposure should be reported through
[SECURITY.md](./SECURITY.md), not public issues or pull requests.
