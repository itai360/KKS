// A small Express for the browser: routers, middleware, error handlers and the
// request/response members the server uses. Requests come from bridge.ts.

export type Next = (err?: unknown) => void;
type Fn = (req: Req, res: Res, next: Next) => unknown;
type ErrFn = (err: unknown, req: Req, res: Res, next: Next) => unknown;

export interface Req {
  method: string;
  url: string;
  path: string;
  baseUrl: string;
  query: Record<string, string | string[]>;
  params: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  raw: Uint8Array | null;
  ip: string;
  user?: unknown;
  get(name: string): string | undefined;
  on(event: string, fn: () => void): void;
  emit(event: string): void;
  [key: string]: unknown;
}

export interface Sink {
  head(status: number, headers: Record<string, string>): void;
  chunk(data: string | Uint8Array): void;
  end(): void;
}

export class Res {
  statusCode = 200;
  headers: Record<string, string> = {};
  cookies: { name: string; value: string | null; maxAge?: number }[] = [];
  headersSent = false;
  finished = false;
  constructor(private sink: Sink) {}

  status(code: number): this {
    this.statusCode = code;
    return this;
  }
  setHeader(name: string, value: string | number): this {
    this.headers[name.toLowerCase()] = String(value);
    return this;
  }
  getHeader(name: string): string | undefined {
    return this.headers[name.toLowerCase()];
  }
  get(name: string): string | undefined {
    return this.getHeader(name);
  }
  set(name: string | Record<string, string>, value?: string): this {
    if (typeof name === 'string') this.setHeader(name, value ?? '');
    else for (const [k, v] of Object.entries(name)) this.setHeader(k, v);
    return this;
  }
  type(t: string): this {
    return this.setHeader('content-type', t.includes('/') ? t : t === 'json' ? 'application/json' : `text/${t}`);
  }
  cookie(name: string, value: string, opts: { maxAge?: number } = {}): this {
    this.cookies.push({ name, value, maxAge: opts.maxAge });
    return this;
  }
  clearCookie(name: string): this {
    this.cookies.push({ name, value: null });
    return this;
  }
  writeHead(status: number, headers: Record<string, string> = {}): this {
    this.statusCode = status;
    for (const [k, v] of Object.entries(headers)) this.setHeader(k, v);
    this.flushHeaders();
    return this;
  }
  flushHeaders(): void {
    if (this.headersSent) return;
    this.headersSent = true;
    this.sink.head(this.statusCode, this.headers);
  }
  write(data: string | Uint8Array): boolean {
    this.flushHeaders();
    this.sink.chunk(data);
    return true;
  }
  end(data?: string | Uint8Array): this {
    if (this.finished) return this;
    if (data !== undefined) this.write(data);
    else this.flushHeaders();
    this.finished = true;
    this.sink.end();
    return this;
  }
  send(body: unknown): this {
    if (body instanceof Uint8Array || typeof body === 'string') return this.end(body);
    return this.json(body);
  }
  json(body: unknown): this {
    if (!this.headers['content-type']) this.setHeader('content-type', 'application/json; charset=utf-8');
    return this.end(JSON.stringify(body));
  }
  sendFile(): this {
    return this.status(404).end();
  }
  download(): this {
    return this.status(501).json({ error: 'הורדת קבצים אינה זמינה בגרסת ההדגמה' });
  }
  on(): this {
    return this;
  }
}

interface Layer {
  method: string | null; // null: middleware (use)
  path: string | RegExp;
  prefix: boolean;
  fns: (Fn | ErrFn)[];
}

function compile(path: string, prefix: boolean): { re: RegExp; keys: string[] } {
  const keys: string[] = [];
  const src = path
    .replace(/\/$/, '')
    .split('/')
    .map((seg) =>
      seg.startsWith(':')
        ? (keys.push(seg.slice(1)), '([^/]+)')
        : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('/');
  return { re: new RegExp(`^${src}${prefix ? '(?=/|$)' : '/?$'}`, 'i'), keys };
}

function match(layer: Layer, path: string): { params: Record<string, string>; matched: string } | null {
  if (layer.path instanceof RegExp) return layer.path.test(path) ? { params: {}, matched: '' } : null;
  if (layer.prefix && (layer.path === '/' || layer.path === '')) return { params: {}, matched: '' };
  const { re, keys } = compile(layer.path, layer.prefix);
  const m = re.exec(path);
  if (!m) return null;
  const params: Record<string, string> = {};
  keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
  return { params, matched: m[0] };
}

export interface Router {
  (req: Req, res: Res, next: Next): void;
  stack: Layer[];
  use(...args: unknown[]): Router;
  get(path: string | RegExp, ...fns: Fn[]): Router;
  post(path: string, ...fns: Fn[]): Router;
  put(path: string, ...fns: Fn[]): Router;
  patch(path: string, ...fns: Fn[]): Router;
  delete(path: string, ...fns: Fn[]): Router;
  disable(name: string): Router;
  set(name: string, value: unknown): Router;
}

function handle(stack: Layer[], req: Req, res: Res, done: Next): void {
  let i = 0;
  const next = (err?: unknown): void => {
    if (res.finished) return;
    const layer = stack[i++];
    if (!layer) return done(err);
    if (layer.method && layer.method !== req.method && !(layer.method === 'GET' && req.method === 'HEAD')) return next(err);
    const m = match(layer, req.path);
    if (!m) return next(err);
    const savedPath = req.path;
    const savedBase = req.baseUrl;
    const savedParams = req.params;
    req.params = { ...req.params, ...m.params };
    if (layer.prefix && m.matched) {
      req.baseUrl = savedBase + m.matched;
      req.path = req.path.slice(m.matched.length) || '/';
    }
    const restore = () => {
      req.path = savedPath;
      req.baseUrl = savedBase;
      req.params = savedParams;
    };
    let j = 0;
    const step = (e?: unknown): void => {
      if (res.finished) return;
      if (e === 'route') {
        restore();
        return next();
      }
      const fn = layer.fns[j++];
      if (!fn) {
        restore();
        return next(e);
      }
      const isErr = fn.length === 4;
      if ((e !== undefined) !== isErr) return step(e);
      try {
        const out = isErr ? (fn as ErrFn)(e, req, res, step) : (fn as Fn)(req, res, step);
        if (out && typeof (out as Promise<unknown>).then === 'function') (out as Promise<unknown>).catch(step);
      } catch (thrown) {
        step(thrown);
      }
    };
    step(err);
  };
  next();
}

function createRouter(): Router {
  const stack: Layer[] = [];
  const router = ((req: Req, res: Res, next: Next) => handle(stack, req, res, next)) as Router;
  router.stack = stack;
  router.use = (...args: unknown[]) => {
    let path = '/';
    if (typeof args[0] === 'string' || args[0] instanceof RegExp) path = args.shift() as string;
    stack.push({ method: null, path, prefix: true, fns: args.flat() as Fn[] });
    return router;
  };
  for (const m of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    router[m] = (path: string | RegExp, ...fns: Fn[]) => {
      stack.push({ method: m.toUpperCase(), path, prefix: false, fns });
      return router;
    };
  }
  router.disable = () => router;
  router.set = () => router;
  return router;
}

const decoder = new TextDecoder();

function json(_opts?: unknown): Fn {
  return (req, _res, next) => {
    if (req.raw && req.raw.length && (req.headers['content-type'] ?? '').includes('application/json')) {
      try {
        req.body = JSON.parse(decoder.decode(req.raw));
      } catch {
        return next({ type: 'entity.parse.failed' });
      }
    }
    next();
  };
}

function raw(_opts?: unknown): Fn {
  return (req, _res, next) => {
    req.body = Buffer.from(req.raw ?? new Uint8Array());
    next();
  };
}

const passthrough: Fn = (_req, _res, next) => next();

interface ExpressFn {
  (): Router;
  Router: () => Router;
  json: typeof json;
  raw: typeof raw;
  static: () => Fn;
}

const express = (() => createRouter()) as ExpressFn;
express.Router = createRouter;
express.json = json;
express.raw = raw;
express.static = () => passthrough;

export const Router = createRouter;
export type Request = Req;
export type Response = Res;
export type NextFunction = Next;
export default express;
