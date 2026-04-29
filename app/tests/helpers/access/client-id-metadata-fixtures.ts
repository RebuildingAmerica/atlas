/**
 * A well-formed client_id_metadata_document fixture used as the baseline for
 * the validation and resolution tests.
 */
export const VALID_CLIENT_ID_METADATA_DOCUMENT = {
  client_id: "https://app.example.com/oauth/client.json",
  client_name: "Example MCP Client",
  redirect_uris: ["https://app.example.com/callback", "http://localhost:3000/callback"],
};

/**
 * Wraps a body value in a JSON Response so the resolver tests can simulate
 * remote document responses without a real network round-trip.
 *
 * @param body - The JSON-serializable body the fake fetch should return.
 */
export function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
