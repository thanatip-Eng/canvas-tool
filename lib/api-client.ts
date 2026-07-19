import { getFirebaseAuth } from './firebase';

/** Error code the server sends when Canvas rejects the stored access token. */
export const CANVAS_TOKEN_INVALID = 'CANVAS_TOKEN_INVALID';

/** Thrown by every api-client helper on a non-ok response. Carries the HTTP status
 *  and the server's error code so callers can branch instead of matching strings. */
export class ApiClientError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = 'ApiClientError';
  }

  /** True when the user's Canvas token is expired or revoked. */
  get isCanvasTokenInvalid(): boolean {
    return this.code === CANVAS_TOKEN_INVALID;
  }
}

type ReauthHandler = () => void;
let reauthHandler: ReauthHandler | null = null;

/**
 * Register a callback fired whenever the server reports an invalid Canvas token.
 * AuthContext uses this to open the re-auth modal from anywhere in the app.
 */
export function onCanvasTokenInvalid(handler: ReauthHandler | null): void {
  reauthHandler = handler;
}

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
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    const err = new ApiClientError(
      data.error || `Request failed: ${res.status}`,
      res.status,
      data.code
    );
    if (err.isCanvasTokenInvalid) reauthHandler?.();
    throw err;
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
