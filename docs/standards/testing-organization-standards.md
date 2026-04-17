# Testing Organization Standards

> **Shared testing principles for all Lovelace packages and crates — language-agnostic.**

For language-specific standards, tooling, and directory conventions, see:

- **TypeScript** — [TypeScript Testing Standards](./typescript-testing-standards.md)
- **Rust** — [Rust Testing Standards](./rust-testing-standards.md)

Tests are the executable specification of the platform. When they are comprehensive, the codebase validates itself automatically and maintenance happens by default — regressions are caught before they reach users, and refactoring is safe because the spec is machine-checked on every change.

---

## General Principles

### Why We Test

Tests exist to give us certainty that what we've built actually works and is reliable. Specifically:

- **Validate that work is done** — A feature, bug fix, or refactor is not complete until tests prove it behaves correctly. Tests are the definition of done.
- **Define user experience** — This is the highest priority. Tests describe what the user should experience. No matter how much effort it takes, verifying and validating end-user behavior comes first.
- **Prevent regressions** — Tests establish a baseline for system behavior. When something breaks, tests catch it before users do.
- **Enable confident change** — Comprehensive tests let us refactor, optimize, and extend the system without fear. They are the safety net that makes velocity sustainable.

### Testing Strategy: Overlapping Confidence

Our strategy deliberately overlaps tests across layers — unit, integration, and higher — to build compounding confidence. A unit test proves a function works in isolation. An integration test proves components collaborate correctly. A higher-level test proves the user gets the experience we promised. Each layer reinforces the others; gaps in one are caught by another. This overlap is intentional, not redundant.

### Test-Driven Mindset

Begin with the end in mind. Before writing implementation code, think about how you will prove it works:

- What should the user experience when this feature is complete?
- What should happen when things go wrong?
- What existing behavior must remain unchanged?

Write tests that answer these questions. The implementation follows from there.

### How We Write Tests

**We optimize for maintainability and understandability.** Tests are production code — they must be readable, well-structured, and easy to change.

1. **Reusability over one-offs** — Favor shared test helpers over ad-hoc setup copied between test files. When you write test infrastructure, ask: "If someone else needs to test similar behavior, can they reuse what I built here?" If yes, put it in the shared test helpers directory for your language.

2. **Readability over cleverness** — A test should read like a specification. Someone unfamiliar with the implementation should understand what is being tested and why from the test name and body alone. Test names are documentation — a well-named test simultaneously specifies and documents behavior. Avoid abstractions that obscure intent.

3. **Determinism over convenience** — Tests must produce the same result every time. Use your language's built-in test utilities for time, environment, and I/O control instead of relying on real system state.

4. **Isolation over shared state** — Each test must be independent. No test should depend on another test's execution or side effects. Use setup and teardown mechanisms to ensure each test starts from a clean state.

5. **Semantic organization over structural mirroring** — Group tests by feature and behavior, not by mirroring the source file tree or by testing concern.

6. **Coverage as a byproduct, not a goal** — We require 100% coverage, but coverage is a side effect of thorough testing, not the objective. Write tests that verify meaningful behavior; coverage follows naturally.

---

## 100% Coverage Policy

All packages and crates MUST achieve 100% test coverage across all metrics:

- **Lines**: 100%
- **Statements / Functions / Branches**: 100%

Coverage is enforced through language-specific tooling — see the language-specific standards above for configuration details.

**Critical Rules:**

- **Never lower thresholds to accommodate incomplete tests**
- **Never use coverage exclusions except for genuinely untestable code**
- **Achieve actual 100% coverage through comprehensive testing**

---

## Compliance

All packages and crates must meet these standards before being accepted into the monorepo.

**Remember**: 100% test coverage is non-negotiable. Incomplete coverage breaks the self-verifying guarantee — it means there are behaviors in the codebase that can regress silently without any automated check catching them. Full coverage ensures the codebase validates itself on every change.
