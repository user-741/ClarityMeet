function normalizeBaseUrl(value: string | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function getAppBaseUrl() {
  const configured = normalizeBaseUrl(
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_VERCEL_URL
  );

  const browserOrigin =
    typeof window !== "undefined" && window.location?.origin ? window.location.origin : undefined;

  // In the browser, always send people back to the address they are using.
  if (browserOrigin) return browserOrigin;

  if (configured) return configured;

  return "http://localhost:3000";
}

export function buildAppUrl(path: string) {
  const baseUrl = getAppBaseUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}
