export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// The serverless deployment numbers every saved change. The app sends back the
// newest number it has seen, so no server copy answers with older data.
let seenVersion = 0;
export function noteVersion(v: unknown): void {
  const n = Number(v);
  if (Number.isFinite(n) && n > seenVersion) seenVersion = n;
}
export function versionHeaders(): Record<string, string> {
  return seenVersion ? { 'x-kks-v': String(seenVersion) } : {};
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

// requests still waiting for an answer, for the stuck-screen report (see reportIssue)
const inflight = new Map<number, { url: string; at: number }>();
let requestSeq = 0;
export function pendingRequests(): { url: string; ms: number }[] {
  return [...inflight.values()].map((r) => ({ url: r.url, ms: Date.now() - r.at }));
}

/** Sends what went wrong in this browser to the server log (rate-limited there). */
export function reportIssue(message: string, details: Record<string, unknown> = {}): void {
  void fetch('/api/client-error', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'x-kks': '1', 'content-type': 'application/json' },
    body: JSON.stringify({
      path: location.pathname.slice(0, 300),
      message: message.slice(0, 500),
      stack: JSON.stringify({ ...details, sw: !!navigator.serviceWorker?.controller, visible: document.visibilityState, online: navigator.onLine, ua: navigator.userAgent }).slice(0, 2000),
    }),
  }).catch(() => undefined);
}

const GET_TIMEOUT_MS = 12_000;

/** One attempt; a read that gets no complete answer in time is cut off instead of waiting forever. */
async function attempt(url: string, init: RequestInit, timeoutMs: number | null): Promise<{ res: Response; text: string }> {
  const ctrl = timeoutMs ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs!) : null;
  const id = ++requestSeq;
  inflight.set(id, { url, at: Date.now() });
  try {
    const res = await fetch(url, ctrl ? { ...init, signal: ctrl.signal } : init);
    return { res, text: await res.text() };
  } finally {
    if (timer) clearTimeout(timer);
    inflight.delete(id);
  }
}

async function request<T>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', cache: 'no-store', headers: { 'x-kks': '1', ...versionHeaders(), ...headers } };
  if (body instanceof Blob || body instanceof ArrayBuffer) {
    init.body = body;
  } else if (body !== undefined) {
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let out: { res: Response; text: string } | null = null;
  // a read is tried twice; a change is sent once, so it is never applied twice
  for (let i = 0; i < (method === 'GET' ? 2 : 1) && !out; i++) {
    try {
      out = await attempt(url, init, method === 'GET' ? GET_TIMEOUT_MS : null);
    } catch (e) {
      const timedOut = (e as Error)?.name === 'AbortError';
      if (timedOut) reportIssue('request timed out', { url, try: i + 1 });
      if (i + 1 >= (method === 'GET' ? 2 : 1)) {
        throw new ApiError(0, timedOut ? 'השרת לא ענה בזמן. נסו לרענן את הדף.' : 'אין חיבור לשרת. בדוק את החיבור ונסה שוב.');
      }
    }
  }
  const { res, text } = out!;
  noteVersion(res.headers.get('x-kks-v'));
  if (res.status === 401 && !url.startsWith('/api/auth/login')) onUnauthorized?.();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'אירעה שגיאה');
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body: unknown = {}) => request<T>('POST', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
  upload: <T>(url: string, file: File) =>
    request<T>('POST', url, file, { 'content-type': file.type || 'application/octet-stream', 'x-filename': encodeURIComponent(file.name) }),
};

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
