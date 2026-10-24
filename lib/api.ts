/**
 * Client for the existing PHP API.
 *
 * The session token is a bearer token in localStorage rather than a cookie, which is how the
 * system this replaces works and what `ae_auth()` on the server expects — it reads
 * `Authorization: Bearer <token>` and nothing else.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? 'https://go.areagles.com/api/v1';

const TOKEN_KEY = 'ae.session.token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    /** The server's own error slug, e.g. `session_required`, so callers can branch on it. */
    readonly code: string,
    readonly status: number,
    readonly payload: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

type Options = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Skip the automatic redirect to /login when the session is gone. */
  quiet?: boolean;
};

export async function api<T = Record<string, unknown>>(
  path: string,
  options: Options = {},
): Promise<T> {
  const { method = 'GET', body, quiet = false } = options;
  const token = getToken();

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    // A non-JSON body means the request never reached the router (WAF, 5xx page).
    throw new ApiError('unexpected_response', res.status);
  }

  if (!res.ok || json.ok === false) {
    const code = typeof json.error === 'string' ? json.error : `http_${res.status}`;
    if (!quiet && (code === 'session_required' || code === 'session_invalid')) {
      setToken(null);
      if (typeof window !== 'undefined') window.location.href = '/login/';
    }
    throw new ApiError(code, res.status, json);
  }

  return json as T;
}

/**
 * Multipart upload, with progress.
 *
 * `fetch` cannot report how far an upload has got — the Streams-based request body is not
 * available everywhere and gives nothing back for a plain FormData — so this one call uses
 * XMLHttpRequest instead. Progress is not decoration here: the job-file endpoint accepts 64 MB,
 * which on a site connection is minutes of a screen that would otherwise look frozen.
 *
 * `onProgress` receives 0–1, or null once the bytes are all sent and the server is still
 * working — a large file spends real time being moved into place after the last byte arrives.
 */
export function apiUpload<T = Record<string, unknown>>(
  path: string,
  form: FormData,
  opts: { onProgress?: (fraction: number | null) => void; signal?: AbortSignal } = {},
): Promise<T> {
  const { onProgress, signal } = opts;

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}${path}`);
    xhr.setRequestHeader('Accept', 'application/json');
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    // Content-Type is deliberately unset: the browser has to add the multipart boundary.

    xhr.upload.onprogress = (e) => {
      if (!onProgress) return;
      onProgress(e.lengthComputable ? e.loaded / e.total : 0);
    };
    xhr.upload.onload = () => onProgress?.(null);

    xhr.onload = () => {
      let json: Record<string, unknown> = {};
      try {
        json = JSON.parse(xhr.responseText) as Record<string, unknown>;
      } catch {
        reject(new ApiError('unexpected_response', xhr.status));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300 || json.ok === false) {
        const code = typeof json.error === 'string' ? json.error : `http_${xhr.status}`;
        if (code === 'session_required' || code === 'session_invalid') {
          setToken(null);
          window.location.href = '/login/';
        }
        reject(new ApiError(code, xhr.status, json));
        return;
      }
      resolve(json as T);
    };

    // A dropped response is not a failed upload: past a certain size the edge stops waiting
    // while the file lands on the server anyway. Callers must re-read rather than assume.
    xhr.onerror = () => reject(new ApiError('upload_interrupted', 0));
    xhr.ontimeout = () => reject(new ApiError('upload_interrupted', 0));
    xhr.onabort = () => reject(new ApiError('upload_aborted', 0));

    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(form);
  });
}

/**
 * Download a file the API serves behind the bearer token.
 *
 * A plain link cannot carry an Authorization header, so the bytes are fetched and handed to
 * the browser as a blob under the name the server chose.
 */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(`http_${res.status}`, res.status);

  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // Revoked on the next tick — Safari needs the element to have been clicked first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
