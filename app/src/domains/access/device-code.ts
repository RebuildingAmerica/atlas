const DEVICE_CODE_GROUP_SIZE = 4;

/**
 * Normalizes a device user code for display and Better Auth verification.
 */
export function normalizeDeviceUserCode(value: string): string {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const groups = normalized.match(new RegExp(`.{1,${DEVICE_CODE_GROUP_SIZE}}`, "g")) ?? [];
  return groups.join("-");
}
