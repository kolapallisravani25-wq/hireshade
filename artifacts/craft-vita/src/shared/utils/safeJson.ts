/**
 * safeJson — WKWebView-safe JSON parser.
 *
 * WKWebView throws "The string did not match the expected pattern" when
 * Response.json() receives non-JSON bodies (e.g. HTML error pages from a
 * proxy or CDN).  This helper parses via res.text() + JSON.parse so errors
 * are handled gracefully without crashing the caller.
 */
export async function safeJson<T = unknown>(res: Response): Promise<T | null> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    console.warn(
      "[safeJson] Non-JSON response from",
      res.url,
      "—",
      text.slice(0, 120),
    );
    return null;
  }
}
