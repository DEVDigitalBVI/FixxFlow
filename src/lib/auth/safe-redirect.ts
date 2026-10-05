/** Resolve callback navigation only after the URL parser has normalized it. */
export function safeAuthRedirect(requested: string | null, origin: string): URL {
  const fallback = new URL("/app", origin);
  if (!requested?.startsWith("/") || /[\\\u0000-\u0020\u007f]/.test(requested)) return fallback;
  try {
    const destination = new URL(requested, origin);
    return destination.origin === fallback.origin ? destination : fallback;
  } catch {
    return fallback;
  }
}
