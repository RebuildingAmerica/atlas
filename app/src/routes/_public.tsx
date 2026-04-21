import { Outlet, createFileRoute } from "@tanstack/react-router";
import { PublicFloatingNav } from "@/platform/layout/public-nav";
import { PublicFooter } from "@/platform/layout/public-footer";

export const Route = createFileRoute("/_public")({
  component: PublicLayout,
});

function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 md:p-4">
        <PublicFloatingNav />
      </header>
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
      <PublicFooter />
    </div>
  );
}
