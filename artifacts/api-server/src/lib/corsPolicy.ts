export function buildCorsOptions(originsValue: string | undefined, nodeEnv: string | undefined) {
  const origins = (originsValue ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length) return { origin: origins };
  return nodeEnv === "production" ? { origin: false } : {};
}
