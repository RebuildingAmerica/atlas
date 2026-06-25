import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_workspace/home")({
  head: () => ({
    meta: [{ title: "My Research | Atlas" }],
  }),
  component: HomeRoute,
});

function HomeRoute() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 py-12">
      <h1 className="type-display-small text-ink-strong">Your research base</h1>
      <p className="type-body-large text-ink-soft">
        Your saved actors, lists, and activity will live here.
      </p>
    </div>
  );
}
