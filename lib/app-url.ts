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

  // .env.local points at localhost for development, but when the site is opened
  // through the public tunnel, links (invites, OAuth redirects) must use the
  // tunnel address or they won't work on anyone else's device.
  const isLocal = (u?: string) => !!u && /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(u);
  if (browserOrigin && (!configured || (isLocal(configured) && !isLocal(browserOrigin)))) {
    return browserOrigin;
  }

  if (configured) return configured;

  return "http://localhost:3000";
}

export function buildAppUrl(path: string) {
  const baseUrl = getAppBaseUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}
