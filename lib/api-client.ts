import { getFirebaseAuth } from './firebase';

async function authHeader(): Promise<Record<string, string>> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error('Not authenticated');
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

/**
 * Drop-in replacement for `fetch` that adds the Firebase ID token.
 * Use when you need direct access to the Response (e.g. streaming, blob).
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const auth = await authHeader();
  for (const [k, v] of Object.entries(auth)) headers.set(k, v);
  return fetch(input, { ...init, headers });
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** GET with optional query params, returns parsed JSON. */
export async function apiGet<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const qs = params
    ? '?' + new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))).toString()
    : '';
  return unwrap<T>(await apiFetch(path + qs));
}

/** POST JSON body, returns parsed JSON. */
export async function apiPostJson<T>(path: string, body: unknown): Promise<T> {
  return unwrap<T>(
    await apiFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

/** POST FormData (e.g. file uploads), returns parsed JSON. */
export async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  return unwrap<T>(await apiFetch(path, { method: 'POST', body: form }));
}
