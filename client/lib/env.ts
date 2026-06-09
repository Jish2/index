export function readEnvSecret(name: string): string | undefined {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }

  return value.trim().replace(/^['"]|['"]$/g, "");
}
