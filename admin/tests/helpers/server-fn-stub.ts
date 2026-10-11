/**
 * A stand-in for TanStack Start's `createServerFn` that runs the handler in
 * the test, after the same input validation the runtime would apply.
 */

interface Validator {
  parse(input: unknown): unknown;
}

interface HandlerInput {
  data: unknown;
}

interface CallInput {
  data?: unknown;
}

type Handler<T> = (input: HandlerInput) => Promise<T>;

export function createServerFnStub() {
  return () => {
    let validator: Validator | undefined;
    const builder = {
      validator(next: Validator) {
        validator = next;
        return builder;
      },
      handler<T>(handler: Handler<T>) {
        // Async, as in the runtime: invalid input rejects rather than throwing.
        return async (input?: CallInput) =>
          handler({
            data: validator ? validator.parse(input?.data) : input?.data,
          });
      },
    };
    return builder;
  };
}
