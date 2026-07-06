import { createRoot } from "react-dom/client";
import { EntityCard, WidgetStatus } from "@rebuildingamerica/entity-widgets";
import { useEntityCardData } from "../adapters/app-client";
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
