import { join } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../src/database/schema';
import {
  acquireSendPermission,
  minuteWindowStart,
  taipeiDayWindowStart,
} from '../../src/automation/send-gate';
import { applyMigrations } from '../helpers/d1-shim';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

// 固定時間：2026-08-01 10:00:00 台北（02:00 UTC）。
const NOW = Date.parse('2026-08-01T02:00:00Z');

beforeEach(() => {
  const sqlite = new Database(':memory:');
  applyMigrations(sqlite, join(__dirname, '../../drizzle/migrations'));
  db = drizzle(sqlite, { schema });
});

async function seedSettings(overrides: Partial<typeof schema.systemSettings.$inferInsert> = {}) {
  await db.insert(schema.systemSettings).values({ id: 'default', emergencyStop: 0, ...overrides });
}

const baseInput = {
  actionType: 'public_reply' as const,
  automationId: 'auto',
  automationDailyLimit: null as number | null,
  nowMs: NOW,
};

describe('window helpers', () => {
  it('aligns minute windows to the minute start', () => {
    expect(minuteWindowStart(Date.parse('2026-08-01T02:00:30Z'))).toBe('2026-08-01T02:00:00.000Z');
    expect(minuteWindowStart(Date.parse('2026-08-01T02:01:00Z'))).toBe('2026-08-01T02:01:00.000Z');
  });

  it('aligns day windows to the Taipei day start (16:00 UTC of the previous day)', () => {
    // 2026-08-01 10:00 台北 → 當日台北 00:00 = 2026-07-31T16:00:00Z
    expect(taipeiDayWindowStart(NOW)).toBe('2026-07-31T16:00:00.000Z');
    // 台北 23:59（15:59 UTC）仍屬同一天
    expect(taipeiDayWindowStart(Date.parse('2026-08-01T15:59:00Z'))).toBe('2026-07-31T16:00:00.000Z');
    // 台北隔日 00:01（16:01 UTC）換窗
    expect(taipeiDayWindowStart(Date.parse('2026-08-01T16:01:00Z'))).toBe('2026-08-01T16:00:00.000Z');
  });
});

describe('acquireSendPermission — emergency stop', () => {
  it('denies when emergency stop is active', async () => {
    await seedSettings({ emergencyStop: 1 });
    const res = await acquireSendPermission(db, baseInput);
    expect(res).toEqual({ allowed: false, reason: 'emergency_stop' });
  });

  it('allows when there are no settings and no caps', async () => {
    const res = await acquireSendPermission(db, baseInput);
    expect(res).toEqual({ allowed: true, reason: null });
  });
});

describe('acquireSendPermission — system minute/day caps', () => {
  it('enforces the per-minute cap for the matching action type', async () => {
    await seedSettings({ maxPublicRepliesPerMinute: 2 });
    expect((await acquireSendPermission(db, baseInput)).allowed).toBe(true);
    expect((await acquireSendPermission(db, baseInput)).allowed).toBe(true);
    const third = await acquireSendPermission(db, baseInput);
    expect(third).toEqual({ allowed: false, reason: 'system_minute_limit' });
  });

  it('does not count public sends against the private cap', async () => {
    await seedSettings({ maxPublicRepliesPerMinute: 1 });
    expect((await acquireSendPermission(db, baseInput)).allowed).toBe(true);
    // public 已滿，但 private 沒設上限 → 仍允許
    const dm = await acquireSendPermission(db, { ...baseInput, actionType: 'private_reply' });
    expect(dm.allowed).toBe(true);
    // public 第二次 → 拒絕
    expect((await acquireSendPermission(db, baseInput)).allowed).toBe(false);
  });

  it('resets the minute window as time advances', async () => {
    await seedSettings({ maxPublicRepliesPerMinute: 1 });
    expect((await acquireSendPermission(db, baseInput)).allowed).toBe(true);
    expect((await acquireSendPermission(db, baseInput)).allowed).toBe(false);
    const nextMinute = await acquireSendPermission(db, { ...baseInput, nowMs: NOW + 60_000 });
    expect(nextMinute.allowed).toBe(true);
  });

  it('enforces the per-day cap across minutes', async () => {
    await seedSettings({ maxPublicRepliesPerDay: 2 });
    expect((await acquireSendPermission(db, baseInput)).allowed).toBe(true);
    expect((await acquireSendPermission(db, { ...baseInput, nowMs: NOW + 60_000 })).allowed).toBe(true);
    const third = await acquireSendPermission(db, { ...baseInput, nowMs: NOW + 120_000 });
    expect(third).toEqual({ allowed: false, reason: 'system_daily_limit' });
  });
});

describe('acquireSendPermission — automation daily limit', () => {
  async function seedRunsToday(count: number) {
    await db.insert(schema.instagramAccounts).values({ id: 'acct', instagramAccountId: 'ig-acct' });
    await db.insert(schema.instagramMedia).values({
      id: 'media',
      instagramAccountId: 'acct',
      instagramMediaId: 'ig-media',
      mediaType: 'IMAGE',
    });
    await db.insert(schema.automations).values({ id: 'auto', instagramMediaId: 'media', name: 'a' });
    for (let i = 0; i < count; i++) {
      await db.insert(schema.automationRuns).values({
        id: `run-${i}`,
        automationId: 'auto',
        instagramCommentId: `c${i}`,
        instagramMediaId: 'ig-media',
        status: 'matched',
        createdAt: new Date(NOW - i * 1000).toISOString(),
      });
    }
  }

  it('denies when today’s runs exceed the automation daily limit', async () => {
    await seedRunsToday(2);
    const res = await acquireSendPermission(db, { ...baseInput, automationDailyLimit: 1 });
    expect(res).toEqual({ allowed: false, reason: 'automation_daily_limit' });
  });

  it('allows when today’s runs are within the limit', async () => {
    await seedRunsToday(2);
    const res = await acquireSendPermission(db, { ...baseInput, automationDailyLimit: 2 });
    expect(res.allowed).toBe(true);
  });

  it('ignores runs from previous Taipei days', async () => {
    await seedRunsToday(1);
    // 加一筆昨天（台北時間）的 run
    await db.insert(schema.automationRuns).values({
      id: 'run-old',
      automationId: 'auto',
      instagramCommentId: 'c-old',
      instagramMediaId: 'ig-media',
      status: 'matched',
      createdAt: '2026-07-31T15:00:00.000Z', // 台北 7/31 23:00
    });
    const res = await acquireSendPermission(db, { ...baseInput, automationDailyLimit: 1 });
    expect(res.allowed).toBe(true);
  });
});
