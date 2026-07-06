// Canonical site origin for absolute URLs (auth redirects, metadataBase).
// Resolution chain: explicit NEXT_PUBLIC_SITE_URL, then Vercel's deploy URL
// (bare hostname, so the scheme is added here), then local dev. Read at call
// time - never at import time - so builds work without any env configured.
export function getSiteOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (typeof configured === 'string' && configured.length > 0) {
    return configured;
  }

  const vercelUrl = process.env.VERCEL_URL;
  if (typeof vercelUrl === 'string' && vercelUrl.length > 0) {
    return `https://${vercelUrl}`;
  }

  return 'http://localhost:3000';
}
