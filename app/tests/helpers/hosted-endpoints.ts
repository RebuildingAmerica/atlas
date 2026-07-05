export function requiredHostedOrigin(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return new URL(value).origin;
}

export function absoluteHostedUrl(origin: string, pathname: string): string {
  return new URL(pathname, origin).toString();
}
