import type { ReactNode } from "react";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import type { TeamSeatCostSummary } from "@/domains/billing/team-cost";
import type { WorkspaceDirectoryConfig } from "@/domains/workspace/server/directory-config";
import type {
  WorkspaceIntegrationMonitoring,
  WorkspaceUsageAuditLog,
  WorkspaceUsageSummary,
} from "@/domains/workspace/server/usage-summary";
import {
  createOrganizationDetailsFixture,
  createWorkspaceSSOProviderFixture,
  createWorkspaceSSOStateFixture,
} from "../../fixtures/access/organizations";
import { createAtlasSessionFixture, createAtlasWorkspace } from "../../fixtures/access/sessions";

interface TestButtonProps {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
}

function TestButton({ children, disabled, onClick, type = "button" }: TestButtonProps) {
  return (
    <button type={type} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

interface TestInputProps {
  label?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  type?: string;
  value?: string;
}

function TestInput({ label, onChange, placeholder, type = "text", value }: TestInputProps) {
  return (
    <label>
      {label}
      <input
        aria-label={label}
        placeholder={placeholder}
        type={type}
        value={value}
        onChange={(event) => {
          onChange?.(event.target.value);
        }}
      />
    </label>
  );
}

interface TestSelectProps {
  disabled?: boolean;
  label?: string;
  onChange?: (value: string) => void;
  options: { label: string; value: string }[];
  value?: string;
}

function TestSelect({ disabled, label, onChange, options, value }: TestSelectProps) {
  return (
    <label>
      {label}
      <select
        aria-label={label}
        disabled={disabled}
        value={value}
        onChange={(event) => {
          onChange?.(event.target.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

interface TestTextareaProps {
  label?: string;
  onChange?: (value: string) => void;
  value?: string;
}

function TestTextarea({ label, onChange, value }: TestTextareaProps) {
  return (
    <label>
      {label}
      <textarea
        aria-label={label}
        value={value}
        onChange={(event) => {
          onChange?.(event.target.value);
        }}
      />
    </label>
  );
}

const samlAllowedIssuersFixture = {
  issuerOrigins: ["https://accounts.google.com"],
};

const teamSeatCostSummaryFixture: TeamSeatCostSummary = {
  additionalSeats: 1,
  additionalSeatsCents: 800,
  baseCents: 2500,
  interval: "monthly",
  maxSeats: 50,
  perSeatCents: 800,
  seatsUsed: 2,
  totalCents: 3300,
};

const usageSummaryFixture: WorkspaceUsageSummary = {
  event_counts: { brief_opened: 2 },
  org_id: "org_123",
  renewal_signals: {
    briefs_used: 2,
    coverage_gaps_closed: 1,
    integrations_used: 0,
    public_records_improved: 3,
    team_workflow_actions: 1,
  },
  total_events: 7,
};

const usageAuditLogFixture: WorkspaceUsageAuditLog = {
  data_boundary: {
    metadata_included: false,
    session_replay_included: false,
    statement:
      "The audit log shows timestamped workspace usage events without private metadata or behavioral session replay.",
  },
  items: [],
  limit: 10,
  offset: 0,
  org_id: "org_123",
  total: 0,
};

const integrationMonitoringFixture: WorkspaceIntegrationMonitoring = {
  api_calls: 0,
  data_boundary: {
    request_metadata_included: false,
    session_replay_included: false,
    statement:
      "Workspace integration activity records counts, surfaces, paths, and last-seen times without request metadata or behavioral session replay.",
  },
  last_seen_at: null,
  mcp_calls: 0,
  org_id: "org_123",
  top_resources: [],
  total_calls: 0,
};

const directoryConfigFixture: WorkspaceDirectoryConfig = {
  org_id: "org_123",
  title: "Atlas public directory",
};

afterEach(() => {
  cleanup();
});

export {
  createOrganizationDetailsFixture,
  createWorkspaceSSOProviderFixture,
  createWorkspaceSSOStateFixture,
  createAtlasSessionFixture,
  createAtlasWorkspace,
  TestButton,
  TestInput,
  TestSelect,
  TestTextarea,
  samlAllowedIssuersFixture,
  teamSeatCostSummaryFixture,
  usageSummaryFixture,
  usageAuditLogFixture,
  integrationMonitoringFixture,
  directoryConfigFixture,
};
