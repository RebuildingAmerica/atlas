import { createRoot } from "react-dom/client";
import { EntityCard } from "../components/entity-card/entity-card";
import { useEntityCardData } from "../adapters/app-client";
import { WidgetStatus } from "../lib/widget-status";
import "../styles/widget.css";

function EntityCardWidget() {
  const state = useEntityCardData();
  return (
    <WidgetStatus
      state={state}
      errorMessage="Something went wrong loading this profile."
    >
      {(data) => <EntityCard data={data} />}
    </WidgetStatus>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error(
    "entity-card widget: #root element not found in entity-card.html",
  );
}

createRoot(rootElement).render(<EntityCardWidget />);
