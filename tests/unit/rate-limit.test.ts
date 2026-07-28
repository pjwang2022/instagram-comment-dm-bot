import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, expect, it } from 'vitest';
import * as schema from '../../src/database/schema';
import {
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_SECONDS,
  checkLoginRateLimit,
} from '../../src/security/rate-limit';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createTestDb(): any {
  const sqlite = new Database(':memory:');
  const migrationsDir = join(__dirname, '../../drizzle/migrations');
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    sqlite.exec(sql.replace(/-->\s*statement-breakpoint/g, ''));
  }
  return drizzle(sqlite, { schema });
}

describe('login rate limit (D1 counter)', () => {
  it('allows exactly LOGIN_MAX_ATTEMPTS attempts then blocks', async () => {
    const db = createTestDb();
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);

    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) {
      expect(await checkLoginRateLimit(db, '1.2.3.4', now)).toBe(true);
    }
    // 第 (MAX+1) 次應被擋下
    expect(await checkLoginRateLimit(db, '1.2.3.4', now)).toBe(false);
  });

  it('tracks different IPs independently', async () => {
    const db = createTestDb();
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);

    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) {
      await checkLoginRateLimit(db, '1.1.1.1', now);
    }
    expect(await checkLoginRateLimit(db, '1.1.1.1', now)).toBe(false);
    // 另一個 IP 不受影響
    expect(await checkLoginRateLimit(db, '2.2.2.2', now)).toBe(true);
  });

  it('resets after the window elapses', async () => {
    const db = createTestDb();
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);

    for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i += 1) {
      await checkLoginRateLimit(db, '3.3.3.3', now);
    }
    expect(await checkLoginRateLimit(db, '3.3.3.3', now)).toBe(false);

    // 跨到下一個窗口後計數重置
    const nextWindow = now + LOGIN_WINDOW_SECONDS * 1000 + 1000;
    expect(await checkLoginRateLimit(db, '3.3.3.3', nextWindow)).toBe(true);
  });

  it('fails closed when the database throws', async () => {
    const brokenDb = {
      delete() {
        throw new Error('db down');
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    expect(await checkLoginRateLimit(brokenDb, '4.4.4.4', Date.now())).toBe(false);
  });
});
