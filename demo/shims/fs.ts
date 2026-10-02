// node:fs for the browser: uploaded files kept in memory and saved with the database.

const files = new Map<string, Uint8Array>();
let onChange: () => void = () => undefined;

export function setFileChangeListener(fn: () => void): void {
  onChange = fn;
}
export function allFiles(): [string, Uint8Array][] {
  return [...files.entries()];
}
export function restoreFiles(entries: [string, Uint8Array][]): void {
  files.clear();
  for (const [k, v] of entries) files.set(k, v);
}

const notFound = (path: string) => Object.assign(new Error(`ENOENT: no such file, '${path}'`), { code: 'ENOENT' });

const dirs = new Set<string>();

export function existsSync(path: string): boolean {
  return files.has(path) || dirs.has(path);
}
export function mkdirSync(path: string): void {
  dirs.add(path);
}
export function writeFileSync(path: string, data: Uint8Array | string): void {
  files.set(path, typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data));
  onChange();
}
export function readFileSync(path: string): Buffer {
  const f = files.get(path);
  if (!f) throw notFound(path);
  return Buffer.from(f);
}
export function unlinkSync(path: string): void {
  files.delete(path);
  onChange();
}
export function rmSync(path: string): void {
  files.delete(path);
}
export function statSync(path: string): { size: number } {
  const f = files.get(path);
  if (!f) throw notFound(path);
  return { size: f.length };
}
export function copyFileSync(from: string, to: string): void {
  writeFileSync(to, readFileSync(from));
}
/** the names of the files directly in a folder */
export function readdirSync(path: string): string[] {
  const prefix = path.endsWith('/') ? path : `${path}/`;
  return [...files.keys()].filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')).map((k) => k.slice(prefix.length));
}
export function createReadStream(path: string) {
  return {
    pipe(res: { end(data: Uint8Array): void }) {
      res.end(readFileSync(path));
    },
  };
}

export default { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, rmSync, statSync, copyFileSync, readdirSync, createReadStream };
