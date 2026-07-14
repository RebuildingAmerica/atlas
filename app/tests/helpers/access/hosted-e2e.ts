export function hostedE2ERequestWithSecret(secret?: string): Request {
  const headers = new Headers();
  if (secret) {
    headers.set("x-atlas-hosted-e2e-secret", secret);
  }
  return new Request("https://atlas-staging.rebuildingus.org/api/e2e/hosted/identity", {
    headers,
    method: "POST",
  });
}

export async function hostedE2EResponsePayload(response: Response): Promise<{ error?: string }> {
  return (await response.json()) as { error?: string };
}
