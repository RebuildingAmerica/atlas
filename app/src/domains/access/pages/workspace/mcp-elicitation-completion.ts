import { useEffect, useRef } from "react";

export const MCP_ELICITATION_PARAM = "mcpElicitationId";

export interface McpElicitationCompleteResponse {
  elicitation_id: string;
  status: "completed";
  target_flow: string;
}

interface UseMcpElicitationCompletionParams {
  enabled: boolean;
  onComplete: (response: McpElicitationCompleteResponse) => void;
}

function readMcpElicitationCompleteResponse(
  result: unknown,
): McpElicitationCompleteResponse | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  if (!("elicitation_id" in result) || !("status" in result) || !("target_flow" in result)) {
    return null;
  }
  const { elicitation_id: elicitationId, status, target_flow: targetFlow } = result;
  if (
    typeof elicitationId !== "string" ||
    status !== "completed" ||
    typeof targetFlow !== "string"
  ) {
    return null;
  }
  return {
    elicitation_id: elicitationId,
    status,
    target_flow: targetFlow,
  };
}

async function completeMcpElicitation(
  elicitationId: string,
): Promise<McpElicitationCompleteResponse | null> {
  const response = await fetch(
    `/api/mcp/elicitations/${encodeURIComponent(elicitationId)}/complete`,
    {
      method: "POST",
    },
  );
  if (!response.ok) {
    return null;
  }
  return readMcpElicitationCompleteResponse(await response.json());
}

export function useMcpElicitationCompletion({
  enabled,
  onComplete,
}: UseMcpElicitationCompletionParams): void {
  const completedMcpElicitationId = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !enabled) {
      return;
    }

    const elicitationId = new URLSearchParams(window.location.search).get(MCP_ELICITATION_PARAM);
    if (!elicitationId || completedMcpElicitationId.current === elicitationId) {
      return;
    }

    completedMcpElicitationId.current = elicitationId;
    void completeMcpElicitation(elicitationId)
      .then((response) => {
        if (response?.status === "completed") {
          onComplete(response);
        }
      })
      .catch(() => undefined);
  }, [enabled, onComplete]);
}
