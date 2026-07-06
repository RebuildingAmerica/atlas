import { createRoot } from "react-dom/client";
import { EntityCard } from "../components/entity-card/entity-card";
import { useEntityCardData } from "../adapters/app-client";
import "../styles/widget.css";

function EntityCardWidget() {
  const { data, error } = useEntityCardData();

  if (error) {
    // Never surface `error.message`/details in the UI — log the real error
    // for diagnostics and show a safe, generic message instead.
    console.error(error);
    return (
      <p className="text-ew-ink-soft p-4 text-sm">
        Something went wrong loading this profile.
      </p>
    );
  }

  if (!data) {
    return <p className="text-ew-ink-soft p-4 text-sm">Loading…</p>;
  }

  return <EntityCard data={data} />;
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error(
    "entity-card widget: #root element not found in entity-card.html",
  );
}

createRoot(rootElement).render(<EntityCardWidget />);
