# TypeScript Testing Standards

> **Test coverage, organization, and quality requirements for all TypeScript packages and applications.**

This document is the TypeScript-specific companion to the shared [Testing Organization Standards](./testing-organization-standards.md) (which covers language-agnostic principles). Everything in the shared document's "General Principles" section applies here; this document adds TypeScript-specific patterns, tooling, and conventions.

---

## Test Layers

TypeScript packages in this workspace use four test layers:

| Layer           | Location             | Tool       | What it tests                                                 |
| --------------- | -------------------- | ---------- | ------------------------------------------------------------- |
| **Unit**        | `tests/unit/`        | Vitest     | Isolated functions, classes, and React components             |
| **Integration** | `tests/integration/` | Vitest     | Multiple components collaborating; no live network or browser |
| **Acceptance**  | `tests/acceptance/`  | Playwright | Full user flows in a real browser                             |
| **E2E**         | `tests/e2e/`         | Vitest     | Service workflows against live infrastructure                 |

Each layer reinforces the others; a bug missed by a unit test is caught by an integration
test, and a behavior not covered by integration tests is caught by acceptance tests.

---

## Test Coverage Requirements

### 100% Coverage Policy

All packages MUST achieve 100% test coverage across all metrics:

- **Lines**: 100%
- **Statements**: 100%
- **Functions**: 100%
- **Branches**: 100%

### Coverage Enforcement

Coverage thresholds are enforced via vitest configuration:

```typescript
// vitest.config.mts
import { createVitestConfig } from "@reasonabletech/config-vitest";

export default createVitestConfig(import.meta.dirname);
// Note: Coverage thresholds are automatically set to 100% in the base config
```

**Critical Rules:**

- **Never lower thresholds to accommodate incomplete tests**
- **Never use coverage exclusions except for genuinely untestable code**
- **Achieve actual 100% coverage through comprehensive testing**

---

## Test Organization Principles

### Semantic Grouping Over Implementation Details

Tests should be organized by **functionality and user intent**, not by implementation details.

#### ✅ Correct Organization

```
tests/unit/
├── navigation-guards.test.ts       # Guard functionality
├── error-handling.test.ts          # Error states and recovery
├── routes.test.ts                  # Route management
├── multi-stack.test.ts             # Multi-stack operations
└── stack.test.ts                   # Single stack operations
```

#### ❌ Incorrect Organization

```
tests/unit/
├── coverage-tests.test.ts          # Bad: organized by testing concern
├── edge-cases.test.ts              # Bad: implementation detail grouping
└── private-methods.test.ts         # Bad: visibility-based grouping
```

---

## Testing Fundamentals

### The Three Distinct Concepts

Testing support files serve completely different purposes and should never be mixed:

- **Fixtures = Test Data** - Pure data objects and data factories
- **Mocks = Fake Implementations** - Replacement objects that simulate real dependencies
- **Helpers = Utility Functions** - Reusable functions that reduce test setup boilerplate

### Fixtures: Test Data Only

**Fixtures provide consistent test data across multiple tests.**

```typescript
// ✅ FIXTURE: Pure data object
export const userFixture = {
  id: "user-123",
  email: "test@example.com",
  name: "Test User",
  createdAt: new Date("2024-01-01"),
};

// ✅ FIXTURE: Data factory function
export function createUserFixture(overrides: Partial<User> = {}): User {
  return {
    ...userFixture,
    ...overrides,
  };
}

// ✅ FIXTURE: Complex data with relationships
export const workspaceFixture = {
  id: "workspace-456",
  name: "Test Workspace",
  ownerId: userFixture.id,
  members: [userFixture],
};

// ❌ NOT A FIXTURE: This is a mock (fake implementation)
export const userServiceFixture = {
  createUser: vi.fn(),
  findUser: vi.fn(),
};

// ❌ NOT A FIXTURE: This is a helper (utility function)
export function setupUserFixture() {
  return render(<UserComponent user={userFixture} />);
}
```

### Mocks: Fake Implementations Only

**Mocks replace real dependencies with controllable fake implementations.**

```typescript
// ✅ MOCK: Fake service implementation
export const mockUserService = {
  createUser: vi.fn().mockResolvedValue(ok(userFixture)),
  findUser: vi.fn().mockResolvedValue(ok(userFixture)),
  updateUser: vi.fn().mockResolvedValue(ok(userFixture)),
};

// ✅ MOCK: Fake external dependency
export const mockApiClient = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

// ✅ MOCK: Fake database client
export const mockDatabase = {
  user: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn((callback) => callback(mockDatabase)),
};

// ❌ NOT A MOCK: This is a fixture (test data)
export const mockUser = {
  id: "user-123",
  email: "test@example.com",
};

// ❌ NOT A MOCK: This is a helper (utility function)
export function mockUserServiceSetup() {
  return new UserService(mockDatabase, mockApiClient);
}
```

**Mock Types Explained:**

- **Mock**: Verifies interactions - tracks calls, parameters, call counts
- **Stub**: Returns predetermined responses - no interaction verification
- **Spy**: Observes real method calls while allowing normal execution
- **Fake**: Working implementation with simplified logic (e.g., in-memory database)

### Helpers: Utility Functions Only

**Helpers reduce boilerplate and provide reusable test setup patterns.**

```typescript
// ✅ HELPER: React testing utility
export function renderWithAuth(
  component: React.ReactElement,
  user: User = userFixture
) {
  return render(
    <AuthProvider user={user}>
      {component}
    </AuthProvider>
  );
}

// ✅ HELPER: Test setup utility
export function setupUserServiceTest() {
  const userService = new UserService(mockDatabase, mockApiClient);

  return {
    userService,
    cleanup: () => {
      vi.clearAllMocks();
    },
  };
}

// ✅ HELPER: Assertion utility
export function expectUserToMatch(actual: User, expected: User) {
  expect(actual.id).toBe(expected.id);
  expect(actual.email).toBe(expected.email);
  expect(actual.name).toBe(expected.name);
}
```

### Usage Examples

**Correct separation in tests:**

```typescript
// Import test data from fixtures
import { userFixture, createUserFixture } from '../fixtures/users';

// Import fake implementations from mocks
import { mockUserService, mockDatabase } from '../mocks/user-service';

// Import utility functions from helpers
import { renderWithAuth, setupUserServiceTest } from '../helpers/test-utils';

describe("UserComponent", () => {
  it("should display user information", () => {
    const user = createUserFixture({ name: "Custom Name" });
    renderWithAuth(<UserComponent />, user);
    expect(screen.getByText("Custom Name")).toBeInTheDocument();
  });

  it("should call user service correctly", async () => {
    const { userService, cleanup } = setupUserServiceTest();
    await userService.createUser(userFixture);
    expect(mockUserService.createUser).toHaveBeenCalledWith(userFixture);
    cleanup();
  });
});
```

### How to Create Effective Test Support Files

**Creating Good Fixtures:**

```typescript
// ✅ Start with minimal valid data
export const minimalUserFixture = {
  id: "user-123",
  email: "test@example.com",
  name: "Test User",
};

// ✅ Create specific variations for edge cases
export const userWithLongNameFixture = {
  ...minimalUserFixture,
  name: "A".repeat(255), // Test boundary condition
};

// ✅ Use factory functions for complex scenarios
export function createUserFixture(overrides: Partial<User> = {}): User {
  return {
    id: `user-${Date.now()}`, // Unique IDs prevent test interference
    email: "test@example.com",
    name: "Test User",
    createdAt: new Date("2024-01-01"),
    ...overrides,
  };
}
```

**Creating Good Mocks:**

```typescript
// ✅ Mock at the service boundary, not internal details
export const mockUserService = {
  createUser: vi.fn(),
  findUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
};

// ✅ Set up default return values that make tests pass
beforeEach(() => {
  mockUserService.createUser.mockResolvedValue(ok(minimalUserFixture));
  mockUserService.findUser.mockResolvedValue(ok(minimalUserFixture));
});

// ✅ Create typed mock factories for consistency
export function createMockUserService(overrides: Partial<UserService> = {}) {
  return {
    createUser: vi.fn().mockResolvedValue(ok(minimalUserFixture)),
    findUser: vi.fn().mockResolvedValue(ok(minimalUserFixture)),
    updateUser: vi.fn().mockResolvedValue(ok(minimalUserFixture)),
    deleteUser: vi.fn().mockResolvedValue(ok(undefined)),
    ...overrides,
  };
}
```

**Creating Good Helpers:**

```typescript
// ✅ Encapsulate common setup patterns
export function renderUserComponent(user: User = minimalUserFixture) {
  return render(
    <AuthProvider user={user}>
      <UserProvider>
        <UserComponent />
      </UserProvider>
    </AuthProvider>
  );
}

// ✅ Create setup utilities that return cleanup functions
export function setupUserServiceTest() {
  const mockDb = createMockDatabase();
  const mockLogger = createMockLogger();
  const userService = new UserService(mockDb, mockLogger);

  return {
    userService,
    mockDb,
    mockLogger,
    cleanup: () => {
      vi.clearAllMocks();
    },
  };
}
```

**Best Practices:**

1. **Fixtures should be deterministic** - Same input always produces same output
2. **Mocks should fail fast** - Don't set up return values that hide real problems
3. **Helpers should reduce duplication** - If you're copying setup code, create a helper
4. **Keep them simple** - Complex fixtures/mocks/helpers are harder to debug than the tests themselves
5. **Name them clearly** - `userFixture` vs `userServiceMock` vs `renderUserHelper`

---

## Directory Structure Requirements

All packages must follow the three-tier testing structure with semantic file organization:

```
tests/
├── setup.ts              # Test configuration and global setup
├── fixtures/             # Test data only - organized by feature/domain
│   ├── auth/
│   │   ├── users.ts      # User data objects and factories
│   │   ├── sessions.ts   # Session/token data
│   │   └── credentials.ts # WebAuthn/passkey data
│   └── workspaces/
│       ├── workspaces.ts # Workspace data objects
│       └── members.ts    # Member/invitation data
├── mocks/                # Fake implementations only - organized by service boundary
│   ├── services/
│   │   ├── user-service.ts    # Mock UserService
│   │   └── auth-service.ts    # Mock AuthService
│   ├── external/
│   │   ├── api-client.ts      # Mock HTTP client
│   │   └── database.ts        # Mock database client
│   └── ui/
│       └── router.ts     # Mock Next.js router
├── helpers/              # Utility functions only - organized by testing concern
│   ├── rendering/
│   │   └── auth-providers.tsx    # renderWithAuth, renderWithUser
│   ├── setup/
│   │   └── service-setup.ts     # setupUserServiceTest, etc.
│   └── assertions/
│       └── user-assertions.ts   # expectUserToBeValid
├── unit/                 # Unit tests (isolated component testing)
├── integration/          # Integration tests (component interactions)
├── acceptance/           # Acceptance tests (Playwright)
└── e2e/                  # Service end-to-end tests (Vitest)
```

### Test File Structure

Each test file should follow this semantic structure:

```typescript
describe("Feature/Component Name", () => {
  describe("Core Functionality", () => {
    it("should handle primary use case", () => {
      // Test main functionality
    });
  });

  describe("Error Handling", () => {
    it("should handle invalid input gracefully", () => {
      // Test error states
    });
  });

  describe("Edge Cases", () => {
    it("should handle boundary conditions", () => {
      // Test edge cases
    });
  });
});
```

---

## Test File Naming

**Test Files (all use `.test.ts` or `.test.tsx`):**

- Unit tests: `user-service.test.ts`, `large-document-processing.test.ts`
- Integration tests: `oauth-flow.test.ts`, `bulk-member-operations.test.ts`
- Acceptance tests: `registration-flow.test.ts`, `concurrent-users.test.ts`
- Service E2E tests: `workspace-provisioning.test.ts`, `billing-reconciliation.test.ts`

**Support Files:**

- Fixtures: `tests/fixtures/[feature]/[domain].ts`
- Mocks: `tests/mocks/services/[service-name].ts`, `tests/mocks/external/[dependency].ts`
- Helpers: `tests/helpers/rendering/[provider-type].tsx`, `tests/helpers/setup/[setup-type].ts`

### Organization Principles

- **Single naming convention** - All tests use `*.test.ts` or `*.test.tsx`
- **Name by functionality** - `large-document-processing.test.ts`, not `document-processing-perf.test.ts`
- **Co-locate related tests** - All auth tests in `auth/` folder regardless of test type
- **Feature-first organization** - Group by what you're testing, not how you're testing it

Use descriptive names that explain functionality:

```typescript
// ✅ Good: Describes behavior and conditions
it("should emit navigation-did-change event when navigation succeeds");
it("should throw error when attempting to navigate with invalid route");
it("should preserve stack state when navigation is cancelled by guard");

// ❌ Bad: Vague or implementation-focused
it("should work");
it("should test navigate function");
it("should cover line 42");
```

---

## Configuration Requirements

### Package.json Scripts

All packages must include these standard test scripts:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "test:acceptance": "playwright test",
    "test:e2e": "vitest run tests/e2e",
    "test:watch": "vitest --watch",
    "test:coverage": "vitest run --coverage"
  }
}
```

### Setup Files Organization

**Test Data (Fixtures) - Organized by Domain:**

```
tests/fixtures/
├── auth/users.ts        # User data objects and factories
├── auth/sessions.ts     # Authentication session data
└── workspaces/workspaces.ts  # Workspace data objects
```

**Fake Implementations (Mocks) - Organized by Service Boundary:**

```
tests/mocks/
├── services/user-service.ts     # Mock internal UserService
├── external/api-client.ts       # Mock HTTP client
└── ui/router.ts                 # Mock Next.js router
```

**Utility Functions (Helpers) - Organized by Testing Concern:**

```
tests/helpers/
├── rendering/auth-providers.tsx   # renderWithAuth, renderWithUser
├── setup/service-setup.ts         # setupUserServiceTest, etc.
└── assertions/user-assertions.ts  # expectUserToBeValid
```

---

## Coverage Achievement Strategies

### 1. Impossible Branch Coverage

For TypeScript exhaustiveness checks:

```typescript
// In implementation
switch (action.type) {
  case "navigate":
    return handleNavigate(action);
  case "goBack":
    return handleGoBack(action);
  default:
    throw new Error(`Invalid navigation action type: ${(action as any).type}`);
}

// In tests
it("should throw error for invalid action types", () => {
  const invalidAction = { type: "invalid-action-type" } as any;
  expect(() => handler(invalidAction)).toThrow(
    "Invalid navigation action type",
  );
});
```

### 2. Private Method Testing

When necessary for branch coverage:

```typescript
it("should cover private method branches", () => {
  const stack = new NavigationStack();
  const privateMethod = (stack as any)._privateMethodName;

  expect(privateMethod(validInput)).toBe(expectedOutput);
  expect(privateMethod(invalidInput)).toBe(fallbackOutput);
});
```

### 3. React Component Testing

For React components, focus on:

1. **Provider functionality**: Context provision and cleanup
2. **Hook behavior**: State management and event handling
3. **Error boundaries**: Proper error handling for missing providers
4. **Type safety**: Generic type parameters work correctly

Avoid async operations that can hang tests:

```typescript
// ✅ Good: Direct state manipulation
it('should update state when navigation changes', async () => {
  const stack = new NavigationStack();

  render(
    <NavigationProvider stack={stack}>
      <TestComponent />
    </NavigationProvider>
  );

  await stack.navigate({ /* ... */ });

  expect(screen.getByTestId('current-route')).toHaveTextContent('expected-route');
});
```

---

## Vitest Built-in Mocking Patterns

Use Vitest's built-in utilities instead of ad-hoc mocking to ensure automatic cleanup and prevent state leakage. **For full examples, rationale, and API references, see the [Vitest Mocking Patterns Guide](../testing/guides/vitest-mocking-patterns.md).**

| Pattern                   | Standard                                                                              | Forbidden                                                    |
| ------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Environment variables** | `vi.stubEnv()` / `vi.unstubAllEnvs()`                                                 | ❌ Direct `process.env.FOO = "bar"` assignment               |
| **Dates**                 | `vi.useFakeTimers()` + `vi.setSystemTime()` in `beforeEach`/`afterEach`               | ❌ Mocking `Date` constructor manually                       |
| **Timers**                | Async variants (`vi.advanceTimersByTimeAsync`, `vi.runAllTimersAsync`) for async code | ❌ Real `setTimeout` waits in tests                          |
| **File system**           | `memfs` + `vi.mock("node:fs")` (always use `"node:fs"` prefix, not bare `"fs"`)       | ❌ Bare `"fs"` module path                                   |
| **HTTP requests**         | MSW `setupServer` for new code; `vi.spyOn(global, "fetch")` for existing code         | ❌ Direct `global.fetch = vi.fn()` assignment                |
| **Parallelism**           | `test.concurrent` only for async-heavy tests                                          | ❌ Concurrent tests with shared mutable state or fake timers |

---

## Test Performance

Slow tests are not a minor inconvenience — they discourage running the suite, which defeats the purpose. Apply these rules during the REFACTOR phase of each TDD cycle.

### Use fake timers instead of real waits

Any test that calls `setTimeout`, `setInterval`, or `await`s a real duration is unnecessarily slow and potentially flaky under CPU load.

```typescript
// ❌ Slow: waits 500 ms of real time in every test run
it("should retry after delay", async () => {
  await new Promise((r) => setTimeout(r, 500));
  expect(retryCount).toBe(1);
});

// ✅ Fast: advances the virtual clock instantly
it("should retry after delay", async () => {
  vi.useFakeTimers();
  await vi.advanceTimersByTimeAsync(500);
  expect(retryCount).toBe(1);
  vi.useRealTimers();
});
```

Use `beforeEach`/`afterEach` to scope fake timers so they do not leak across tests:

```typescript
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
```

### Keep `beforeEach` lightweight

`beforeEach` runs before every test in the suite. Expensive setup compounds across hundreds of tests.

```typescript
// ❌ Slow: reads from disk before every test
beforeEach(async () => {
  config = await fs.readFile("./fixtures/config.json", "utf8");
});

// ✅ Fast: constructs the value directly
beforeEach(() => {
  config = { apiUrl: "https://api.test", timeout: 5000 };
});
```

### Mock at system boundaries only

Mocking internal helpers adds no performance benefit (the code is in-process anyway) and couples the test to implementation details. Only mock at the boundary between your code and external systems.

| Mock here                      | Do not mock here                   |
| ------------------------------ | ---------------------------------- |
| Database client (`prisma`)     | Internal `validateEmail()` utility |
| HTTP client (`fetch`, `axios`) | Internal `formatDate()` helper     |
| Filesystem (`node:fs`)         | Internal `parseConfig()` function  |
| System clock (`Date`, timers)  | Internal service methods you own   |

### Parallelize async-heavy tests deliberately

`test.concurrent` runs tests in parallel within a `describe` block. Use it for async-heavy tests that share no mutable state and do not use fake timers.

```typescript
describe("API key generation", () => {
  // ✅ Safe to parallelize: each test creates its own mock
  it.concurrent("should generate unique keys", async () => {
    /* ... */
  });
  it.concurrent("should reject duplicate names", async () => {
    /* ... */
  });
});

// ❌ Unsafe: fake timers are global state — concurrent tests will interfere
it.concurrent("should retry after timeout", async () => {
  vi.useFakeTimers(); // ← race condition with other concurrent tests
});
```

---

## Quality Gates

### Pre-commit Requirements

All tests must pass before commit:

```bash
pnpm test --coverage  # Must achieve 100% across all metrics
pnpm lint            # Must pass with zero errors
pnpm typecheck       # Must pass with zero errors
```

### Never Use These Commands

- **`git commit --no-verify`** - ABSOLUTELY FORBIDDEN - bypasses critical quality gates
- **`--no-verify`** - Never bypass pre-commit hooks
- Coverage threshold manipulation to avoid writing proper tests

---

## Implementation Guidelines

For detailed implementation patterns and examples, see:

- **[Vitest Mocking Patterns](../testing/guides/vitest-mocking-patterns.md)** - Standardized env, timer, FS, and HTTP mocking
- **[Writing Tests Guide](../testing/guides/writing-tests.md)** - Practical implementation instructions
- **[Testing Patterns](../testing/reference/test-patterns-library.md)** - Common testing patterns library
- **[TypeScript Standards](./typescript-standards.md)** - Type safety requirements
- **[Error Handling](./error-handling.md)** - Structured error detection patterns
- **[Rust Testing Standards](./rust-testing-standards.md)** - Rust-specific patterns

---

## Example: @lovelace-ai/navigation Package

Our navigation package demonstrates these principles with:

- **223 tests** achieving **100% coverage** across all metrics
- **Semantic organization**: navigation-guards, error-handling, routes, multi-stack, stack, types, index, react
- **No coverage exclusions** or threshold manipulation
- **Comprehensive edge case testing** including impossible TypeScript cases
- **React integration testing** without hanging async operations

---

## Compliance

All packages must meet these standards before being accepted into the monorepo. Use the testing standards validation tools to verify compliance.

**Remember**: 100% test coverage is non-negotiable. It ensures code reliability, prevents regressions, and maintains the high quality standards that make the Lovelace platform robust and trustworthy.

---

## Related

- [Performance Standards](./performance-standards.md) --- For service instrumentation requirements and performance-sensitive code rules
- [Service-Level Objectives](./service-level-objectives.md) --- Service and app performance targets
