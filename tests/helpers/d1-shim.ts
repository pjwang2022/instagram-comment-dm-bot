import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type Database from 'better-sqlite3';

// 用 better-sqlite3 實作一個滿足 drizzle-orm/d1 所需 D1Database 介面的最小 shim。
// drizzle 的 d1 driver 只用到 prepare().bind().all()/run()/raw() 與 batch()。
// D1 與 SQLite 相容，僅用於測試（Worker 執行期仍是真正的 D1）。
export function createD1Shim(sqlite: Database.Database): D1Database {
  const prepare = (query: string) => {
    const stmt = sqlite.prepare(query);
    const makeBound = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => makeBound(next),
      async first(col?: string) {
        const row = stmt.get(...params) as Record<string, unknown> | undefined;
        if (!row) return null;
        return col ? (row[col] ?? null) : row;
      },
      async all() {
        const results = stmt.reader ? (stmt.all(...params) as unknown[]) : [];
        if (!stmt.reader) stmt.run(...params);
        return { results, success: true, meta: {} } as D1Result;
      },
      async run() {
        stmt.run(...params);
        return { results: [], success: true, meta: {} } as D1Result;
      },
      async raw() {
        return (stmt.reader ? stmt.raw().all(...params) : []) as unknown as never;
      },
    });
    return makeBound([]);
  };

  return {
    prepare,
    async batch(statements: D1PreparedStatement[]) {
      const out: D1Result[] = [];
      for (const s of statements) out.push(await s.all());
      return out;
    },
    async exec(query: string) {
      sqlite.exec(query);
      return { count: 0, duration: 0 } as D1ExecResult;
    },
    dump: async () => new ArrayBuffer(0),
    withSession: () => {
      throw new Error('not implemented in test shim');
    },
  } as unknown as D1Database;
}

// 載入 migrations 到一個 in-memory sqlite（測試用）。
export function applyMigrations(sqlite: Database.Database, migrationsDir: string): void {
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    sqlite.exec(sql.replace(/-->\s*statement-breakpoint/g, ''));
  }
}
