/**
 * Result shape returned by the shared server-function test stub.
 */
export interface ServerFnExecutionResponse<TResult = unknown> {
  context: unknown;
  error: unknown;
  result: TResult | undefined;
}

/**
 * Validator contract supported by the shared server-function test stub.
 */
interface ParsedValidator {
  parse(input: unknown): unknown;
}

/**
 * Result value supported by the shared server-function test stub.
 */
type ServerFnResult<TResult = unknown> =
  | Promise<TResult>
  | TResult
  | object
  | string
  | number
  | boolean
  | null
  | undefined;

/**
 * Builds a reusable `createServerFn` stub for unit tests that exercise Atlas
 * server functions without a full TanStack Start runtime.
 */
export function createServerFnStub() {
  return () => {
    let validateInput: ((input: unknown) => unknown) | undefined;

    const builder = {
      /**
       * Stores the input validator so the test stub can mimic runtime parsing.
       *
       * @param validator - The validator used by the server function.
       */
      inputValidator(validator: ParsedValidator | ((input: unknown) => unknown)) {
        validateInput =
          typeof validator === "function" ? validator : (input) => validator.parse(input);

        return builder;
      },
      /**
       * Preserves the TanStack Start builder shape used in production code.
       */
      middleware() {
        return builder;
      },
      /**
       * Wraps the server-function handler in an executable test double.
       *
       * @param handler - The server-function handler under test.
       */
      handler<TResult>(handler: (input: { data: unknown }) => ServerFnResult<TResult>) {
        /**
         * Executes the wrapped handler with validated test input.
         *
         * @param input - The optional server-function input payload.
         */
        function execute(input?: { data?: unknown }) {
          return Promise.resolve(
            handler({
              data: validateInput ? validateInput(input?.data) : input?.data,
            }),
          );
        }

        return Object.assign(async (input?: { data?: unknown }) => execute(input), {
          /**
           * Mirrors the helper TanStack Start attaches for server-side tests.
           *
           * @param input - The simulated server execution payload.
           */
          __executeServer: async (
            input: {
              method?: string;
              data?: unknown;
              headers?: HeadersInit;
              context?: unknown;
            } = {},
          ): Promise<ServerFnExecutionResponse<TResult>> => {
            try {
              const resultPromise = execute(input);
              const result = await resultPromise;

              return {
                context: input.context,
                error: undefined,
                result,
              };
            } catch (error) {
              return {
                context: input.context,
                error,
                result: undefined,
              };
            }
          },
        });
      },
    };

    return builder;
  };
}
