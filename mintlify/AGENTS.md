# AGENTS.md

Guidance for AI coding agents working in `mintlify/`.

## Audience

Mintlify is the public Atlas documentation site. Treat every page in this
directory as end-user, customer, partner, operator, or developer-consumer
documentation. It is not the place for internal engineering notes.

## Hard Boundary

Technical information is welcome when it is part of the public contract or helps
users operate Atlas. Be precise about what users can observe, configure, rely
on, or troubleshoot.

Do not put internal debugging, CI behavior, test harness details, implementation
workarounds, agent-to-agent notes, private operational history, or maintainer
troubleshooting into Mintlify docs. Do not hide core functionality behind
maintainer language or explain how the repository works when the reader only
needs to use Atlas.

Examples that do not belong here:

- GitHub Actions quirks, Vercel build investigations, local pre-push failures,
  lockfile recovery, or branch cleanup notes.
- Test-only environment variables, fixture behavior, mocked credential stores,
  Playwright setup, coverage gates, or acceptance-test repair guidance.
- Internal module names, private helper functions, adapter behavior, or
  implementation details that users do not need in order to use Atlas.
- Debugging trails such as "this fails because CI lacks Secret Service" or "this
  works around Linux runners."
- Explanations aimed at future agents or maintainers.

Put that material in internal docs instead, such as `docs/development/`,
`docs/design/`, code comments near the behavior, or the PR/commit body.

Examples that do belong here:

- "Scout stores login tokens in your operating system's credential store."
- "`SEARCH_API_KEY` can be used as an automation override for a single shell or
  script."
- "Direct URL runs do not require login. Sync and worker mode do."
- "Runs with `--location` and `--issues` require search-backed discovery."
- Public API authentication, scopes, rate limits, error codes, payload fields,
  and CLI command behavior.

If a detail is technical but helps a reader decide what to do next, keep it. If
it only helps a maintainer, move it out of Mintlify.

## What Belongs Here

Mintlify pages should help readers understand and use Atlas:

- What the product, API, MCP server, or Scout CLI is for.
- How to install, configure, run, and verify user-facing workflows.
- What commands, inputs, scopes, rate limits, errors, and outputs mean.
- How to recover from problems a real user can encounter, with concrete next
  steps and no internal machinery.
- Context that improves trust: data provenance, source links, confidence,
  limitations, permissions, privacy, credential storage, and operational
  expectations.
- Integration guidance for people building with public Atlas surfaces.

## Writing Standard

Prefer direct usage guidance over implementation explanation. If a technical
detail helps a reader decide what to do next, keep it. If it only explains how
the repository, CI, tests, or private internals work, move it to internal docs.

For troubleshooting pages, write from the user's point of view:

- Name the visible symptom.
- Give the command or setting to check.
- Explain the user-facing requirement in plain language.
- Provide the shortest recovery path.

Do not hide behavior that matters to users. If Atlas stores credentials in the
operating system credential store, requires a search key for a workflow, or has
a public fallback such as an environment-variable override, document that in
plain user-facing language. If behavior only matters to maintainers, document it
outside `mintlify/`.
