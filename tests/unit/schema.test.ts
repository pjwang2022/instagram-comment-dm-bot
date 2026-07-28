import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, expect, it } from 'vitest';
import * as schema from '../../src/database/schema';

// D1 是 SQLite 相容的引擎，測試環境用 better-sqlite3 驗證 Drizzle schema 的
// migration 與 $defaultFn 行為（Worker 執行期仍是 drizzle-orm/d1，不受影響）。
function createTestDb() {
  const sqlite = new Database(':memory:');
  const migrationsDir = join(__dirname, '../../drizzle/migrations');
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    sqlite.exec(sql.replace(/-->\s*statement-breakpoint/g, ''));
  }
  return drizzle(sqlite, { schema });
}

describe('D1 schema migration', () => {
  it('creates all 12 tables', () => {
    const sqlite = new Database(':memory:');
    const migrationsDir = join(__dirname, '../../drizzle/migrations');
    for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      sqlite.exec(sql.replace(/-->\s*statement-breakpoint/g, ''));
    }
    const rows = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual([
      'admin_users',
      'api_attempts',
      'audit_logs',
      'automation_keywords',
      'automation_runs',
      'automations',
      'instagram_accounts',
      'instagram_media',
      'login_rate_limits',
      'public_reply_variants',
      'system_settings',
      'webhook_events',
    ]);
  });

  it('inserts an admin_users row without created_at/updated_at and still succeeds', async () => {
    const db = createTestDb();

    await db.insert(schema.adminUsers).values({
      id: 'admin-1',
      email: 'admin@example.com',
      passwordHash: 'placeholder-hash',
    });

    const [row] = await db.select().from(schema.adminUsers);
    expect(row.email).toBe('admin@example.com');
    expect(typeof row.createdAt).toBe('string');
    expect(typeof row.updatedAt).toBe('string');
    expect(() => new Date(row.createdAt).toISOString()).not.toThrow();
  });

  it('enforces automation_runs UNIQUE(automation_id, instagram_comment_id)', async () => {
    const db = createTestDb();

    await db.insert(schema.instagramAccounts).values({
      id: 'acct-1',
      instagramAccountId: 'ig-acct-1',
    });
    await db.insert(schema.instagramMedia).values({
      id: 'media-1',
      instagramAccountId: 'acct-1',
      instagramMediaId: 'ig-media-1',
      mediaType: 'IMAGE',
    });
    await db.insert(schema.automations).values({
      id: 'automation-1',
      instagramMediaId: 'media-1',
      name: 'test automation',
    });
    await db.insert(schema.automationRuns).values({
      id: 'run-1',
      automationId: 'automation-1',
      instagramCommentId: 'comment-1',
      instagramMediaId: 'media-1',
      status: 'matched',
    });

    await expect(
      db.insert(schema.automationRuns).values({
        id: 'run-2',
        automationId: 'automation-1',
        instagramCommentId: 'comment-1',
        instagramMediaId: 'media-1',
        status: 'matched',
      }),
    ).rejects.toThrow();
  });
});
