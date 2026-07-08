import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  deleteWorkspaceSCIMProviderConnection,
  generateWorkspaceSCIMToken,
  loadWorkspaceSCIMSetup,
  type AtlasWorkspaceSCIMTokenResult,
} from "@/domains/access/scim.functions";
import { Button } from "@/platform/ui/button";
import { Input } from "@/platform/ui/input";
import { useToast } from "@/platform/ui/toast";
import { WorkspaceSSOCopyField } from "./workspace-sso-copy-field";

export const workspaceScimSetupQueryKey = ["auth", "scim-setup"] as const;

interface WorkspaceSCIMSectionProps {
  canManageOrganization: boolean;
}

export function WorkspaceSCIMSection({ canManageOrganization }: WorkspaceSCIMSectionProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [providerId, setProviderId] = useState("");
  const [generatedToken, setGeneratedToken] = useState<AtlasWorkspaceSCIMTokenResult | null>(null);
  const setupQuery = useQuery({
    enabled: canManageOrganization,
    queryFn: () => loadWorkspaceSCIMSetup(),
    queryKey: workspaceScimSetupQueryKey,
  });
  const generateTokenMutation = useMutation({
    mutationFn: generateWorkspaceSCIMToken,
  });
  const deleteProviderMutation = useMutation({
    mutationFn: deleteWorkspaceSCIMProviderConnection,
  });
  const setup = generatedToken ?? setupQuery.data;
  const providerIdTrimmed = providerId.trim();

  useEffect(() => {
    if (!providerIdTrimmed && setupQuery.data?.defaultProviderId) {
      setProviderId(setupQuery.data.defaultProviderId);
    }
  }, [providerIdTrimmed, setupQuery.data?.defaultProviderId]);

  async function refreshSetup() {
    await queryClient.invalidateQueries({ queryKey: workspaceScimSetupQueryKey });
  }

  async function handleGenerateToken(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!providerIdTrimmed) {
      return;
    }

    try {
      const result = await generateTokenMutation.mutateAsync({
        data: {
          providerId: providerIdTrimmed,
        },
      });
      setGeneratedToken(result);
      await refreshSetup();
      toast.success("SCIM token generated.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Atlas could not generate a SCIM token.",
      );
    }
  }

  async function handleDeleteProvider(connectionProviderId: string) {
    try {
      await deleteProviderMutation.mutateAsync({
        data: {
          providerId: connectionProviderId,
        },
      });
      if (generatedToken?.providerId === connectionProviderId) {
        setGeneratedToken(null);
      }
      await refreshSetup();
      toast.success("SCIM connection removed.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Atlas could not remove that SCIM connection.",
      );
    }
  }

  if (!canManageOrganization) {
    return (
      <section className="border-outline-variant bg-surface space-y-3 rounded-[1.5rem] border p-6">
        <h2 className="type-title-medium text-on-surface">SCIM provisioning</h2>
        <p className="type-body-medium text-outline">Only workspace admins can manage SCIM.</p>
      </section>
    );
  }

  return (
    <section className="border-outline-variant bg-surface space-y-5 rounded-[1.5rem] border p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="type-title-medium text-on-surface">SCIM provisioning</h2>
          <p className="type-body-small text-outline">Team workspace user lifecycle</p>
        </div>
        <span className="type-label-small border-outline-variant text-outline rounded-full border px-3 py-1">
          Team
        </span>
      </div>

      {setupQuery.isError ? (
        <p className="type-body-medium text-red-600">SCIM setup is unavailable.</p>
      ) : null}

      {setup ? (
        <div className="grid gap-3 md:grid-cols-2">
          <WorkspaceSSOCopyField label="SCIM base URL" value={setup.scimBaseUrl} />
          <WorkspaceSSOCopyField
            label="Service provider config"
            value={setup.serviceProviderConfigUrl}
            truncateAt={72}
          />
          <WorkspaceSSOCopyField label="Users endpoint" value={setup.usersUrl} />
          {generatedToken ? (
            <WorkspaceSSOCopyField label="Bearer token" value={generatedToken.scimToken} mono />
          ) : null}
        </div>
      ) : null}

      <form
        className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]"
        onSubmit={(event) => {
          void handleGenerateToken(event);
        }}
      >
        <Input
          label="Provider ID"
          value={providerId}
          onChange={setProviderId}
          placeholder={setupQuery.data?.defaultProviderId ?? "workspace-scim"}
          disabled={setupQuery.isLoading || generateTokenMutation.isPending}
        />
        <div className="flex items-end">
          <Button
            type="submit"
            disabled={!providerIdTrimmed || setupQuery.isLoading || generateTokenMutation.isPending}
          >
            {generateTokenMutation.isPending ? "Generating..." : "Generate token"}
          </Button>
        </div>
      </form>

      <div className="space-y-3">
        <h3 className="type-title-small text-on-surface">Connections</h3>
        {setupQuery.isLoading ? <p className="type-body-medium text-outline">Loading</p> : null}
        {setup?.providers.length ? (
          <ul className="divide-outline-variant border-outline-variant rounded-2xl border">
            {setup.providers.map((provider) => (
              <li
                key={provider.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0"
              >
                <div>
                  <p className="type-label-large text-on-surface">{provider.providerId}</p>
                  <p className="type-body-small text-outline">Organization-scoped</p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={deleteProviderMutation.isPending}
                  onClick={() => {
                    void handleDeleteProvider(provider.providerId);
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : setupQuery.isLoading ? null : (
          <p className="type-body-medium text-outline">No SCIM connections.</p>
        )}
      </div>
    </section>
  );
}
