type DeviceEndpoint = "approve" | "approved" | "code" | "deny" | "status" | "token";
type DeviceResult = "denied" | "failed";

export function deviceAuthPath(endpoint: DeviceEndpoint): string {
  return `/device/${endpoint}`;
}

export function deviceAuthUrl(baseUrl: string, endpoint: DeviceEndpoint): string {
  return new URL(deviceAuthPath(endpoint), baseUrl).toString();
}

export function deviceResultPath(result: DeviceResult): string {
  return `/device?status=${result}`;
}
