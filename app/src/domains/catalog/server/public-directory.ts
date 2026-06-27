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

export interface PublicDirectoryResponse {
  workspace: PublicDirectoryWorkspace;
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
