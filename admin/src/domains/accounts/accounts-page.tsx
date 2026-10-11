import { useMutation } from "@tanstack/react-query";
import { errorMessage } from "@/platform/error-message";
import { findAccount } from "./accounts.functions";
import { AccountsView } from "./accounts-view";

export function AccountsPage() {
  // A mutation, not a query: each lookup is a deliberate, audited request,
  // never one the page repeats on its own.
  const lookup = useMutation({
    mutationFn: (query: string) => findAccount({ data: { query } }),
  });

  return (
    <AccountsView
      errorMessage={
        lookup.isError
          ? errorMessage(lookup.error, "The lookup could not be made.")
          : undefined
      }
      isSearching={lookup.isPending}
      onSearch={(query) => {
        lookup.mutate(query);
      }}
      result={lookup.data}
    />
  );
}
