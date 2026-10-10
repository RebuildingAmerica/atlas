import { useState, type FormEvent, type ReactNode } from "react";
import type { AtlasWorkspaceMembership } from "@rebuildingamerica/atlas-access";
import { RadioOption } from "@rebuildingamerica/atlas-ui/ui/radio-option";
import { Input } from "@rebuildingamerica/atlas-ui/ui/input";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { PurchaseFlow, PurchaseFlowHeading } from "@/domains/billing/components/purchase-flow";

type WorkspaceSelection = { kind: "existing"; workspaceId: string } | { kind: "new" };
export type WorkspaceSubmission =
  { kind: "existing"; workspaceId: string } | { kind: "new"; name: string };

interface WorkspaceStepProps {
  workspaces: AtlasWorkspaceMembership[];
  productLabel: string;
  pending: boolean;
  error: ReactNode;
  onContinue?: (selection: WorkspaceSubmission) => void;
}

export function WorkspaceStep({
  workspaces,
  productLabel,
  pending,
  error,
  onContinue,
}: WorkspaceStepProps) {
  const [selection, setSelection] = useState<WorkspaceSelection>(() => {
    const first = workspaces.at(0);
    return first ? { kind: "existing", workspaceId: first.id } : { kind: "new" };
  });
  const [name, setName] = useState("");
  const validSelection =
    selection.kind === "new"
      ? Boolean(name.trim())
      : workspaces.some((workspace) => workspace.id === selection.workspaceId);
  const handleSubmit = onContinue
    ? (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onContinue(selection.kind === "new" ? { kind: "new", name: name.trim() } : selection);
      }
    : undefined;
  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-1 flex-col">
      <PurchaseFlow
        header={
          <PurchaseFlowHeading
            productLabel={productLabel}
            title={workspaces.length ? "Choose a workspace" : "Create a workspace"}
            description="Keep your research, notes and shortlists together."
          />
        }
        action={
          <Button
            className="w-full"
            type="submit"
            size="lg"
            disabled={pending || !onContinue || !validSelection}
          >
            {pending ? "Saving…" : "Review plan"}
          </Button>
        }
      >
        {error}
        <fieldset disabled={pending || !onContinue} className="space-y-6">
          <legend className="sr-only">Workspace</legend>
          {workspaces.length ? (
            <div className="space-y-3">
              {workspaces.map((workspace) => (
                <RadioOption
                  key={workspace.id}
                  name="workspace"
                  value={workspace.id}
                  label={workspace.name}
                  description={
                    workspace.workspaceType === "team" ? "Team workspace" : "Personal workspace"
                  }
                  checked={selection.kind === "existing" && selection.workspaceId === workspace.id}
                  onChange={() => {
                    setSelection({ kind: "existing", workspaceId: workspace.id });
                  }}
                />
              ))}
              <RadioOption
                name="workspace"
                value="new"
                label="New workspace"
                description="Keep a separate set of notes and shortlists."
                checked={selection.kind === "new"}
                onChange={() => {
                  setSelection({ kind: "new" });
                }}
              />
            </div>
          ) : null}
          {selection.kind === "new" ? (
            <Input
              label="Workspace name"
              name="workspaceName"
              density="comfortable"
              value={name}
              onChange={setName}
              required
              maxLength={80}
              autoComplete="off"
            />
          ) : null}
        </fieldset>
      </PurchaseFlow>
    </form>
  );
}
