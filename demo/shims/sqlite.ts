// node:sqlite for the browser, on top of sql.js (SQLite compiled to JS).
// Implements the small part of DatabaseSync / StatementSync that server/src/db.ts uses.

interface SqlStatement {
  bind(values: unknown[]): boolean;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  reset(): void;
}
interface SqlDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): SqlStatement;
  getRowsModified(): number;
  export(): Uint8Array;
  close(): void;
}
export interface SqlJs {
  Database: new (data?: Uint8Array) => SqlDatabase;
}

export type SQLInputValue = null | number | bigint | string | Uint8Array;

let SQL: SqlJs | null = null;
const preloaded = new Map<string, Uint8Array>();
let last: DatabaseSync | null = null;

export function setSqlJs(s: SqlJs): void {
  SQL = s;
}
/** The next DatabaseSync opened at this path starts from these bytes. */
export function preloadDatabase(path: string, bytes: Uint8Array): void {
  preloaded.set(path, bytes);
}
export function lastOpenedDatabase(): DatabaseSync | null {
  return last;
}

export class StatementSync {
  private stmt: SqlStatement | null = null;
  private gen = -1;
  constructor(
    private db: DatabaseSync,
    private sql: string,
  ) {}

  private ready(): SqlStatement {
    // export() closes and reopens the database, which frees every statement
    if (!this.stmt || this.gen !== this.db.gen) {
      this.stmt = this.db.handle.prepare(this.sql);
      this.gen = this.db.gen;
    }
    return this.stmt;
  }

  all(...params: SQLInputValue[]): Record<string, unknown>[] {
    const s = this.ready();
    try {
      s.bind(params);
      const rows: Record<string, unknown>[] = [];
      while (s.step()) rows.push(s.getAsObject());
      return rows;
    } finally {
      s.reset();
    }
  }

  get(...params: SQLInputValue[]): Record<string, unknown> | undefined {
    const s = this.ready();
    try {
      s.bind(params);
      return s.step() ? s.getAsObject() : undefined;
    } finally {
      s.reset();
    }
  }

  run(...params: SQLInputValue[]): { changes: number; lastInsertRowid: number } {
    const s = this.ready();
    try {
      s.bind(params);
      s.step();
    } finally {
      s.reset();
    }
    const changes = this.db.handle.getRowsModified();
    const id = this.db.lastId.get() as { id: number };
    return { changes, lastInsertRowid: Number(id.id) };
  }
}

export class DatabaseSync {
  handle: SqlDatabase;
  gen = 0;
  readonly lastId: StatementSync;
  private pragmas: string[] = [];

  constructor(readonly path: string) {
    if (!SQL) throw new Error('sql.js is not loaded');
    const bytes = preloaded.get(path);
    preloaded.delete(path);
    this.handle = bytes ? new SQL.Database(bytes) : new SQL.Database();
    this.lastId = new StatementSync(this, 'SELECT last_insert_rowid() AS id');
    last = this;
  }

  exec(sql: string): void {
    const t = sql.trim();
    // the database lives in memory: no WAL file, no other writers to wait for
    if (/^PRAGMA\s+(journal_mode|busy_timeout)\b/i.test(t)) return;
    if (/^PRAGMA\s+\w+\s*=/i.test(t)) this.pragmas.push(t);
    this.handle.exec(sql);
  }

  prepare(sql: string): StatementSync {
    return new StatementSync(this, sql);
  }

  /** The whole database file, for saving. Must not run inside a transaction. */
  serialize(): Uint8Array {
    const bytes = this.handle.export();
    this.gen++;
    for (const p of this.pragmas) this.handle.exec(p);
    return bytes;
  }

  close(): void {
    this.handle.close();
  }
}
