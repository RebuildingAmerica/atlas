import { useInfiniteQuery } from "@tanstack/react-query";
import { userFacingErrorMessage } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import { useHydrated } from "@/platform/runtime/use-hydrated";
import {
  listEditorialActivity,
  type EditorialActivityPage as ActivityPage,
} from "./editorial-activity.functions";
import { EditorialActivityView } from "./editorial-activity-view";

/** The cursor for the next, older page; null asks for the newest. */
type ActivityCursor = string | null;

function loadActivityPage(before: ActivityCursor): Promise<ActivityPage> {
  return listEditorialActivity({ data: { before } });
}

export function EditorialActivityPage() {
  const hydrated = useHydrated();
  const activity = useInfiniteQuery({
    enabled: hydrated,
    getNextPageParam: (page: ActivityPage) => page.nextBefore,
    initialPageParam: null as ActivityCursor,
    queryFn: ({ pageParam }) => loadActivityPage(pageParam),
    queryKey: ["editorial", "activity"],
  });

  return (
    <EditorialActivityView
      errorMessage={
        activity.isError
          ? userFacingErrorMessage(activity.error, "Editorial activity could not load.")
          : undefined
      }
      hasMore={activity.hasNextPage}
      isLoading={activity.isPending}
      isLoadingMore={activity.isFetchingNextPage}
      items={activity.data?.pages.flatMap((page: ActivityPage) => page.items) ?? []}
      onLoadMore={() => {
        void activity.fetchNextPage();
      }}
    />
  );
}
