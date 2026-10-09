import { Input } from "@rebuildingamerica/atlas-ui/ui/input";

export interface DecisionReasonFieldProps {
  label: string;
  onChange: (value: string) => void;
  value: string;
}

/**
 * Where an editor says why they decided. The reason is kept in the audit log
 * and shown on the editorial activity page next to the decision.
 */
export function DecisionReasonField({ label, onChange, value }: DecisionReasonFieldProps) {
  return (
    <Input
      label={label}
      onChange={onChange}
      placeholder="Shown with this decision in editorial activity"
      value={value}
    />
  );
}
