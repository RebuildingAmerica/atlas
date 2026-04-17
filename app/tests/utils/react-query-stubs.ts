/**
 * Creates a minimal `useMutation` stub that executes the supplied mutation
 * function immediately and reports a non-pending state.
 */
export function createMutationHookStub() {
  return (options: { mutationFn: (input?: unknown) => Promise<unknown> }) => ({
    isPending: false,
    mutateAsync: async (input?: unknown) => {
      const mutationPromise = options.mutationFn(input);
      const mutationResult = await mutationPromise;

      return mutationResult;
    },
  });
}

/**
 * Creates a minimal `useQuery` stub that respects the `enabled` flag while
 * returning a fixed query result.
 *
 * @param data - The query data to expose when the query is enabled.
 * @param isLoading - Whether the query should report a loading state.
 */
export function createQueryHookStub<T>(data: T, isLoading = false) {
  return (options: { enabled?: boolean }) => {
    if (!options.enabled) {
      return {
        data: undefined,
        isLoading: false,
      };
    }

    return {
      data,
      isLoading,
    };
  };
}
