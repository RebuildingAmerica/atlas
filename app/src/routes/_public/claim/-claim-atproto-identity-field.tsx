import { useState } from "react";
import type { AtprotoIdentityResponse } from "@/lib/generated/atlas-schemas";
import { Button } from "@/platform/ui/button";
import { FieldBlock } from "./-claim-form-fields";

interface ClaimAtprotoIdentityFieldProps {
  identities: AtprotoIdentityResponse[];
  isError: boolean;
  selectedIdentityId: string;
  onConnectAnother: (handle: string) => void;
  onSelect: (identityId: string) => void;
}

export function ClaimAtprotoIdentityField({
  identities,
  isError,
  selectedIdentityId,
  onConnectAnother,
  onSelect,
}: ClaimAtprotoIdentityFieldProps) {
  const [connectHandle, setConnectHandle] = useState("");
  return (
    <FieldBlock
      label="ATProto identity"
      help="Choose an account connected in Account settings or connect another account."
      htmlFor="claim-atproto-identity"
    >
      {isError ? (
        <p className="type-body-small text-error">Could not load ATProto identities.</p>
      ) : (
        <select
          id="claim-atproto-identity"
          className="border-outline-variant focus:ring-accent bg-surface-container-lowest text-on-surface w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-none"
          value={selectedIdentityId}
          onChange={(event) => {
            onSelect(event.target.value);
          }}
        >
          <option value="">No ATProto identity</option>
          {identities.map((identity) => {
            const available =
              identity.control_status === "active" && identity.resolution_status === "verified";
            return (
              <option key={identity.id} value={identity.id} disabled={!available}>
                {identity.current_handle}
                {available ? "" : " — needs attention"}
              </option>
            );
          })}
        </select>
      )}
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <input
          aria-label="Another ATProto handle"
          className="border-outline-variant focus:ring-accent bg-surface-container-lowest text-on-surface w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-none"
          placeholder="person.example"
          value={connectHandle}
          onChange={(event) => {
            setConnectHandle(event.target.value);
          }}
        />
        <Button
          disabled={!connectHandle.trim()}
          variant="secondary"
          onClick={() => {
            onConnectAnother(connectHandle.trim());
          }}
        >
          Connect another account
        </Button>
      </div>
    </FieldBlock>
  );
}
