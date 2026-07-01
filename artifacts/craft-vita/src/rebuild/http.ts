export const API_BASE = import.meta.env.VITE_BACKEND_URL || "";

export async function getJson<T>(path: string, auth?: string | null): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: auth ? { Authorization: `Bearer ${auth}` } : {},
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed: ${res.status}`);
  return data as T;
}

export async function postJson<T>(path: string, auth: string | null | undefined, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed: ${res.status}`);
  return data as T;
}

export async function postForm<T>(path: string, auth: string | null | undefined, body: Record<string, string>): Promise<T> {
  const form = new FormData();
  for (const [k, v] of Object.entries(body)) form.append(k, v);
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: auth ? { Authorization: `Bearer ${auth}` } : {},
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed: ${res.status}`);
  return data as T;
}
