// Node globals the server code expects (injected by the demo build).
import { Buffer } from 'buffer';

// buffer@6 has no base64url, which session tokens use
const toString = Buffer.prototype.toString;
Buffer.prototype.toString = function (this: Buffer, encoding?: string, ...rest: number[]) {
  if (encoding === 'base64url') return toString.call(this, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return toString.call(this, encoding as BufferEncoding, ...rest);
} as typeof toString;

const process = { env: {} as Record<string, string | undefined>, argv: [] as string[], platform: 'browser', exit: () => undefined };

export { Buffer, process };
