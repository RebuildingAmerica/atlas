export interface MockSignOutFetchOptions {
  onSuccess?: () => void | Promise<void>;
}

export interface MockSignOutInput {
  fetchOptions?: MockSignOutFetchOptions;
}
