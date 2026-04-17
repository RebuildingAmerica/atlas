import { Link } from "@tanstack/react-router";

/**
 * Empty state shown when Atlas cannot resolve an active workspace.
 */
export function OrganizationEmptyState() {
  return (
    <div className="border-border bg-surface rounded-[1.5rem] border p-6">
      <p className="type-title-medium text-ink-strong">No active workspace</p>
      <p className="type-body-medium text-ink-soft mt-2">
        Atlas could not find an active workspace. Refresh your session or head back to{" "}
        <Link className="text-ink-strong underline" to="/discovery">
          Discovery
        </Link>
        .
      </p>
    </div>
  );
}
