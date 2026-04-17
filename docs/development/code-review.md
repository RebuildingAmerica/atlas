# Code Review

[Docs](../README.md) > [Development](./README.md) > Code Review

Code review is where we check whether a change is ready to live in the
repo, not just whether it compiles.

This guide covers what authors should do before asking for review, what
reviewers should look for, and how to handle feedback well.

## What Authors Should Do Before Review

Before opening or requesting review on a PR:

- Run `make quality`
- Make sure the change has a clear purpose
- Keep unrelated work out of the PR
- Update docs when behavior, workflow, or public contracts changed
- Re-read the diff as if you did not write it

Your PR description should explain:

- What changed
- Why it changed
- Any important risks or tradeoffs
- How it was tested

## What Reviewers Should Look For

Reviewers should focus on:

- Correctness
- Regressions or edge cases
- Clarity and maintainability
- Whether the code matches Atlas standards and patterns
- Whether the tests and docs are sufficient for the change

Questions worth asking:

- Does the code do what the author says it does?
- Is the contract clear?
- Is the data flow easy to follow?
- Are types and schemas doing enough work?
- Are there hidden side effects or weak failure paths?

## What Good Review Feedback Looks Like

Good review feedback is:

- Specific
- Actionable
- Grounded in behavior, maintainability, or standards
- Kind without being vague

Strong examples:

- “This prop looks optional, but the component appears to require it in every code path. Can we make it required?”
- “This API handler is doing validation, persistence, and ranking in one function. Can we move the ranking logic into a helper so the route stays thin?”
- “This adds a new response shape. Can we update the docs and add one regression test for the empty case?”

Weak examples:

- “This feels weird”
- “Can you clean this up?”
- “I don’t like this”

## Responding To Review Feedback

When you receive review feedback:

- Assume the reviewer is trying to improve the change
- Ask for clarification when the feedback is unclear
- Make the smallest honest fix that resolves the issue
- Push follow-up commits with clear messages
- Reply in the thread when the change is addressed

Do not:

- Get defensive
- Pretend to agree when you do not
- Ignore a real concern because the tests happen to pass

## Review Checklist

Authors and reviewers can both use this list:

- The change is scoped and coherent
- Tests cover the behavior that changed
- Docs match the new behavior where needed
- Types and schemas are clear
- Optionality and nullability are intentional
- Naming and structure follow Atlas style guidance
- Failure paths are understandable

## Related Docs

- [Workflow](./workflow.md)
- [Code Style](../standards/code-style.md)
- [Testing](./testing.md)
