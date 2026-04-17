## Test Layout

App tests live in `app/tests` and are organized first by test kind, then by
ownership.

- `unit/domains/<domain>/...` contains unit coverage for a specific product domain
- `unit/platform/...` contains unit coverage for shared infrastructure and runtime code
- `e2e/domains/<domain>/...` contains Playwright coverage owned by a specific domain
- `e2e/helpers/...`, `e2e/fixtures/...`, and `e2e/mocks/...` contain shared end-to-end support code

Keep tests out of `src`. New tests should go under either `unit` or `e2e`, then
into the matching domain or platform subtree so the tree scales cleanly.
