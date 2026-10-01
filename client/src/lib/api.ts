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

async function request<T>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', cache: 'no-store', headers: { 'x-kks': '1', ...versionHeaders(), ...headers } };
  if (body instanceof Blob || body instanceof ArrayBuffer) {
    init.body = body;
  } else if (body !== undefined) {
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, 'אין חיבור לשרת. בדוק את החיבור ונסה שוב.');
  }
  noteVersion(res.headers.get('x-kks-v'));
  if (res.status === 401 && !url.startsWith('/api/auth/login')) onUnauthorized?.();
  const text = await res.text();
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
