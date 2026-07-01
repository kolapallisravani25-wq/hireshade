let _getTokenFn: (() => Promise<string | null>) | null = null;

export function registerGetToken(fn: () => Promise<string | null>): void {
  _getTokenFn = fn;
}

export async function getAuthToken(): Promise<string | null> {
  if (!_getTokenFn) return null;
  try {
    return await _getTokenFn();
  } catch {
    return null;
  }
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
