## Test Layout

API tests stay under `api/tests`, but they are organized by ownership rather
than as one flat directory.

- `domains/<domain>/...` contains domain behavior tests
- `platform/...` contains cross-domain configuration, database, MCP, and
  runtime contract tests
- `support/...` contains reusable test helpers and strategies

Keep new behavior tests out of the top-level `tests` directory. Shared fixtures
that must be discovered globally may remain in top-level `conftest.py`.
Avoid test modules whose only purpose is repo guardrails, coverage bookkeeping,
or test-tooling setup. Product-facing behavior should live beside the
app/service surface it exercises.
