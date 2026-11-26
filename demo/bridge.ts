// Runs the real server (server/src) inside the page. The app's fetch('/api/...'),
// its EventSource and links to files are routed here instead of to a network
// server, and the database is saved in this browser (IndexedDB).

import { demoHooks } from '../client/src/lib/demo';
import { createApp } from '../server/src/app';
import { startScheduler } from '../server/src/automation';
import { db, openDb } from '../server/src/db';
import { seedDemoData } from '../server/src/demoData';
import { saveFile } from './download';
import { Res, type Req, type Router, type Sink } from './shims/express';
import { allFiles, restoreFiles, setFileChangeListener } from './shims/fs';
import { lastOpenedDatabase, preloadDatabase, setSqlJs, type SqlJs } from './shims/sqlite';

const DB_PATH = 'data/kks.db';
const COOKIE_KEY = 'kks.demo.cookies';
const enc = new TextEncoder();
const dec = new TextDecoder();

let app: Router;
let dirty = false;
let resetting = false;

// ---------------- saved state (IndexedDB) ----------------

interface SavedState {
  db: Uint8Array;
  files: [string, Uint8Array][];
}

function openIdb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const r = indexedDB.open('kks-demo', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('state');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  const d = await openIdb();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const r = fn(d.transaction('state', mode).objectStore('state'));
      r.onsuccess = () => resolve((r.result as T) ?? null);
      r.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

const loadState = () => idb<SavedState>('readonly', (s) => s.get('current'));
const clearState = () => idb('readwrite', (s) => s.delete('current'));

async function persist(): Promise<void> {
  const raw = lastOpenedDatabase();
  if (!raw || resetting) return;
  dirty = false;
  const state: SavedState = { db: raw.serialize(), files: allFiles() };
  await idb('readwrite', (s) => s.put(state, 'current'));
}

// ---------------- cookies ----------------

function readCookies(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(COOKIE_KEY) ?? '{}');
  } catch {
    return memoryCookies;
  }
}
let memoryCookies: Record<string, string> = {};
function writeCookies(c: Record<string, string>): void {
  memoryCookies = c;
  try {
    localStorage.setItem(COOKIE_KEY, JSON.stringify(c));
  } catch {
    /* kept in memory for this visit */
  }
}

// ---------------- requests ----------------

function dispatch(method: string, url: string, headers: Record<string, string>, raw: Uint8Array | null, sink: Sink): Req {
  const u = new URL(url, 'http://demo.local');
  const query: Record<string, string | string[]> = {};
  u.searchParams.forEach((v, k) => {
    const cur = query[k];
    query[k] = cur === undefined ? v : Array.isArray(cur) ? [...cur, v] : [cur, v];
  });
  const cookies = readCookies();
  const listeners = new Map<string, (() => void)[]>();
  const req: Req = {
    method,
    url: u.pathname + u.search,
    path: u.pathname,
    baseUrl: '',
    query,
    params: {},
    headers: { ...headers, cookie: Object.entries(cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ') },
    body: undefined,
    raw,
    ip: '127.0.0.1',
    get(name: string) {
      return this.headers[name.toLowerCase()];
    },
    on(event: string, fn: () => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), fn]);
    },
    emit(event: string) {
      for (const fn of listeners.get(event) ?? []) fn();
    },
  };
  const res = new Res({
    head: (s, h) => sink.head(s, h),
    chunk: (d) => sink.chunk(d),
    end: () => {
      if (res.cookies.length) {
        const next = readCookies();
        for (const c of res.cookies) {
          if (c.value === null || c.maxAge === 0) delete next[c.name];
          else next[c.name] = c.value;
        }
        writeCookies(next);
      }
      if (method !== 'GET') dirty = true;
      sink.end();
    },
  });
  try {
    app(req, res, (err) => {
      if (!res.finished) res.status(err ? 500 : 404).json({ error: err ? 'שגיאת שרת' : 'לא נמצא' });
      if (err) console.error(err);
    });
  } catch (e) {
    console.error(e);
    if (!res.finished) res.status(500).json({ error: 'שגיאת שרת' });
  }
  return req;
}

function headerObject(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  new Headers(h).forEach((v, k) => (out[k.toLowerCase()] = v));
  return out;
}

async function bodyBytes(body: BodyInit | null | undefined): Promise<Uint8Array | null> {
  if (body === undefined || body === null) return null;
  if (typeof body === 'string') return enc.encode(body);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  return enc.encode(String(body));
}

/** Answers a request with the in-page server. */
export async function serve(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = headerObject(init.headers);
  const raw = await bodyBytes(init.body);
  return new Promise((resolve) => {
    let status = 200;
    let hdrs: Record<string, string> = {};
    const chunks: Uint8Array[] = [];
    dispatch(method, url, headers, raw, {
      head(s, h) {
        status = s;
        hdrs = { ...h };
        delete hdrs['content-length'];
      },
      chunk(d) {
        chunks.push(typeof d === 'string' ? enc.encode(d) : d);
      },
      end() {
        const size = chunks.reduce((n, c) => n + c.length, 0);
        const body = new Uint8Array(size);
        let o = 0;
        for (const c of chunks) (body.set(c, o), (o += c.length));
        const empty = [101, 204, 205, 304].includes(status);
        resolve(new Response(empty ? null : body, { status, headers: hdrs }));
      },
    });
  });
}

// ---------------- live updates ----------------

type Listener = (e: Event) => void;

/** EventSource that listens to the in-page server's /api/stream. */
class DemoEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readyState = 0;
  withCredentials = false;
  onopen: Listener | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: Listener | null = null;
  private req: Req | null = null;
  private buf = '';
  private listeners = new Map<string, Set<Listener>>();

  constructor(readonly url: string) {
    setTimeout(() => this.connect(), 0);
  }

  private connect(): void {
    if (this.readyState === 2) return;
    this.req = dispatch('GET', this.url, { accept: 'text/event-stream' }, null, {
      head: (status) => {
        if (status !== 200) {
          this.readyState = 2;
          this.fire('error', new Event('error'));
          return;
        }
        this.readyState = 1;
        this.fire('open', new Event('open'));
      },
      chunk: (d) => this.feed(typeof d === 'string' ? d : dec.decode(d)),
      end: () => {
        if (this.readyState === 1) {
          this.readyState = 0;
          this.fire('error', new Event('error'));
          setTimeout(() => this.connect(), 3000);
        }
      },
    });
  }

  private feed(text: string): void {
    this.buf += text;
    let i: number;
    while ((i = this.buf.indexOf('\n\n')) >= 0) {
      const frame = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      const data = frame
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data) this.fire('message', new MessageEvent('message', { data }));
    }
  }

  private fire(type: string, e: Event): void {
    const handler = (this as unknown as Record<string, unknown>)[`on${type}`];
    if (typeof handler === 'function') handler.call(this, e);
    for (const l of this.listeners.get(type) ?? []) l(e);
  }

  addEventListener(type: string, fn: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }
  close(): void {
    this.readyState = 2;
    this.req?.emit('close');
  }
}

// ---------------- files opened from links ----------------

function showFileOverlay(content: Node | string, file?: { name: string; blob: Blob }): void {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.style.zIndex = '400';
  const box = document.createElement('div');
  box.className = 'modal';
  box.style.maxWidth = '720px';
  const body = document.createElement('div');
  body.className = 'modal-body';
  body.style.maxHeight = '70vh';
  body.style.overflow = 'auto';
  if (typeof content === 'string') {
    const p = document.createElement('p');
    p.textContent = content;
    body.append(p);
  } else body.append(content);
  const foot = document.createElement('div');
  foot.className = 'modal-foot';
  if (file) {
    const save = document.createElement('button');
    save.className = 'btn btn-primary';
    save.textContent = 'שמירת הקובץ';
    const note = document.createElement('span');
    note.className = 'small muted';
    save.onclick = () =>
      void saveFile(file.name, file.blob).catch((e: Error) => {
        note.textContent = e.message;
      });
    foot.append(save, note);
  }
  const close = document.createElement('button');
  close.className = 'btn';
  close.textContent = 'סגירה';
  close.onclick = () => wrap.remove();
  foot.append(close);
  box.append(body, foot);
  wrap.append(box);
  wrap.onclick = (e) => e.target === wrap && wrap.remove();
  document.body.append(wrap);
}

async function openFile(href: string): Promise<void> {
  const res = await serve(href);
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    return showFileOverlay(data?.error ?? 'הקובץ לא נמצא');
  }
  const type = res.headers.get('content-type') ?? '';
  const blob = await res.blob();
  const encoded = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get('content-disposition') ?? '')?.[1];
  const file = { name: encoded ? decodeURIComponent(encoded) : 'file', blob };
  if (/^image\//.test(type)) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(blob);
    img.style.maxWidth = '100%';
    return showFileOverlay(img, file);
  }
  const text = await blob.slice(0, 200_000).text();
  if (/^text\/|json|csv/.test(type) || (!/[\u0000-\u0008]/.test(text) && blob.size < 200_000)) {
    const pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.margin = '0';
    pre.textContent = text;
    return showFileOverlay(pre, file);
  }
  showFileOverlay(`${file.name}: אין תצוגה מקדימה לקובץ מהסוג הזה.`, file);
}

// ---------------- boot ----------------

function install(): void {
  const realFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('/api/')) return serve(url, init);
    return realFetch(input, init);
  };
  (window as unknown as { EventSource: unknown }).EventSource = DemoEventSource;
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as Element | null)?.closest?.('a');
      const href = a?.getAttribute('href');
      if (!href?.startsWith('/api/')) return;
      e.preventDefault();
      void openFile(href);
    },
    true,
  );
}

async function resetDemo(): Promise<void> {
  // stop saving first, so a background save cannot write the old data back
  resetting = true;
  await clearState();
  writeCookies({});
  location.reload();
  // if the frame does not reload, start over in place: the app's next request signs out
  setTimeout(() => {
    openDb(DB_PATH);
    seedDemoData();
    resetting = false;
    dirty = true;
  }, 1500);
}

declare global {
  interface Window {
    initSqlJs?: () => Promise<SqlJs>;
  }
}
declare const __SQLJS_FALLBACK__: string;

/** sql.js comes from a CDN script tag in the page; if that CDN failed, try another. */
async function loadSqlJs(): Promise<() => Promise<SqlJs>> {
  if (!window.initSqlJs) {
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = __SQLJS_FALLBACK__;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('sql.js did not load'));
      document.head.append(s);
    });
  }
  if (!window.initSqlJs) throw new Error('sql.js did not load');
  return window.initSqlJs;
}

export async function boot(): Promise<void> {
  const initSqlJs = await loadSqlJs();
  setSqlJs(await initSqlJs());
  const saved = await loadState();
  if (saved?.db) {
    preloadDatabase(DB_PATH, saved.db);
    restoreFiles(saved.files ?? []);
  }
  openDb(DB_PATH);
  if (!db().get<{ n: number }>('SELECT count(*) AS n FROM users')!.n) {
    seedDemoData();
    dirty = true;
  }
  app = createApp() as unknown as Router;
  startScheduler();
  setInterval(() => (dirty = true), 60_000); // the automation may have changed data
  setInterval(() => dirty && void persist(), 1500);
  document.addEventListener('visibilitychange', () => document.hidden && dirty && void persist());
  setFileChangeListener(() => (dirty = true));
  demoHooks.reset = resetDemo;
  install();
}
