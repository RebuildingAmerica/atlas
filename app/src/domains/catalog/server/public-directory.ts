import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getServerApiBaseUrl } from "@/platform/config/app-config";
import type { Entry } from "@/types";

export interface PublicDirectoryWorkspace {
  id: string;
  name: string;
  custom_domain?: PublicDirectoryDomain | null;
}

export interface PublicDirectoryDomain {
  domain: string;
  status: "verified";
}

export interface PublicDirectoryTrustFooter {
  label: string;
  provenance_required: boolean;
  body: string;
}

export interface PublicDirectoryFederation {
  label: string;
  shared_record_count: number;
  source_backed_record_count: number;
  review_required: boolean;
  status: string;
  minimum_confidence: string;
  provenance_stamped_ingestion: boolean;
  body: string;
}

export interface PublicDirectoryScope {
  issue_area_ids: string[];
  geography_labels: string[];
  entry_types: string[];
}

export interface PublicDirectoryStats {
  record_count: number;
  source_count: number;
  source_backed_record_count: number;
  last_reviewed_at: string | null;
}

export interface PublicDirectoryPublication {
  visibility: "public";
  private_notes_exposed: boolean;
}

export interface PublicDirectoryMethodology {
  summary: string;
  source_policy: string;
  review_policy: string;
  correction_policy: string;
  correction_path_template: string;
  missing_context_path_template: string;
}

export interface PublicDirectoryResponse {
  title: string;
  sponsor_label?: string | null;
  workspace: PublicDirectoryWorkspace;
  scope: PublicDirectoryScope;
  stats: PublicDirectoryStats;
  publication: PublicDirectoryPublication;
  methodology: PublicDirectoryMethodology;
  entries: Entry[];
  trust_footer: PublicDirectoryTrustFooter;
  federation?: PublicDirectoryFederation;
}

const publicDirectorySchema = z.object({
  orgId: z.string().min(1),
});

function serverApiBaseUrl(): string {
  return getServerApiBaseUrl({
    ATLAS_PUBLIC_URL: process.env.ATLAS_PUBLIC_URL,
    ATLAS_SERVER_API_PROXY_TARGET: process.env.ATLAS_SERVER_API_PROXY_TARGET,
  });
}

export const loadPublicDirectory = createServerFn({ method: "GET" })
  .inputValidator(publicDirectorySchema)
  .handler(async ({ data }): Promise<PublicDirectoryResponse> => {
    const response = await fetch(
      `${serverApiBaseUrl()}/orgs/${encodeURIComponent(data.orgId)}/entries/public-directory`,
      {
        headers: { Accept: "application/json" },
      },
    );

    if (!response.ok) {
      throw new Error("Public directory could not be loaded.");
    }

    return (await response.json()) as PublicDirectoryResponse;
  });
