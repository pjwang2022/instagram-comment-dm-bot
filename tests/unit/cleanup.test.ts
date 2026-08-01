import { join } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../src/database/schema';
import { runDataCleanup, scheduledJobForCron, CLEANUP_CRON } from '../../src/maintenance/cleanup';
import { applyMigrations } from '../helpers/d1-shim';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

const NOW = Date.parse('2026-08-01T02:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

beforeEach(() => {
  const sqlite = new Database(':memory:');
  applyMigrations(sqlite, join(__dirname, '../../drizzle/migrations'));
  db = drizzle(sqlite, { schema });
});

async function seedWebhookEvent(id: string, receivedAt: string) {
  await db.insert(schema.webhookEvents).values({
    id,
    eventKey: 'key-' + id,
    eventType: 'comments',
    rawPayload: JSON.stringify({ some: 'payload', id }),
    signatureValid: 1,
    receivedAt,
    lastReceivedAt: receivedAt,
  });
}

async function seedAttempt(id: string, completedAt: string) {
  await db.insert(schema.apiAttempts).values({
    id,
    automationRunId: 'run-x',
    actionType: 'public_reply',
    attemptNumber: 1,
    startedAt: completedAt,
    completedAt,
  });
}

describe('runDataCleanup — webhook payload retention (30 days)', () => {
  it('clears raw payloads older than 30 days but keeps the rows and recent payloads', async () => {
    await seedWebhookEvent('old', iso(31 * DAY_MS));
    await seedWebhookEvent('fresh', iso(1 * DAY_MS));

    const result = await runDataCleanup(db, NOW);
    expect(result.webhookPayloadsCleared).toBe(1);

    const rows = await db.select().from(schema.webhookEvents);
    expect(rows).toHaveLength(2);
    const old = rows.find((r: { id: string }) => r.id === 'old');
    const fresh = rows.find((r: { id: string }) => r.id === 'fresh');
    expect(old.rawPayload).toBe('{}');
    expect(JSON.parse(fresh.rawPayload).some).toBe('payload');
  });

  it('does not re-clear already-cleared payloads', async () => {
    await seedWebhookEvent('old', iso(31 * DAY_MS));
    await runDataCleanup(db, NOW);
    const second = await runDataCleanup(db, NOW);
    expect(second.webhookPayloadsCleared).toBe(0);
  });
});

describe('runDataCleanup — api attempt retention (180 days)', () => {
  it('deletes attempts older than 180 days and keeps recent ones', async () => {
    await seedAttempt('old', iso(181 * DAY_MS));
    await seedAttempt('fresh', iso(1 * DAY_MS));

    const result = await runDataCleanup(db, NOW);
    expect(result.apiAttemptsDeleted).toBe(1);

    const rows = await db.select().from(schema.apiAttempts);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('fresh');
  });
});

describe('runDataCleanup — login rate limit buckets', () => {
  it('deletes expired windows for every IP, keeps the current window', async () => {
    await db.insert(schema.loginRateLimits).values([
      { id: 'a', ipAddress: '1.1.1.1', windowStart: iso(2 * DAY_MS), attemptCount: 3 },
      { id: 'b', ipAddress: '2.2.2.2', windowStart: iso(2 * DAY_MS), attemptCount: 1 },
      { id: 'c', ipAddress: '3.3.3.3', windowStart: iso(0), attemptCount: 1 },
    ]);

    const result = await runDataCleanup(db, NOW);
    expect(result.loginRateLimitRowsDeleted).toBe(2);

    const rows = await db.select().from(schema.loginRateLimits);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('c');
  });
});

describe('runDataCleanup — send counters', () => {
  it('deletes counters from previous day windows', async () => {
    await db.insert(schema.sendCounters).values([
      { id: 'old', scopeKey: 'public_reply:day', windowStart: iso(3 * DAY_MS), count: 5 },
      { id: 'today', scopeKey: 'public_reply:day', windowStart: '2026-07-31T16:00:00.000Z', count: 2 },
    ]);

    const result = await runDataCleanup(db, NOW);
    expect(result.sendCounterRowsDeleted).toBe(1);

    const rows = await db.select().from(schema.sendCounters);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('today');
  });
});

describe('runDataCleanup — bounded batches', () => {
  it('processes more rows than one batch', async () => {
    for (let i = 0; i < 5; i++) await seedWebhookEvent(`old-${i}`, iso(40 * DAY_MS));
    for (let i = 0; i < 5; i++) await seedAttempt(`old-${i}`, iso(200 * DAY_MS));

    const result = await runDataCleanup(db, NOW, { batchSize: 2 });
    expect(result.webhookPayloadsCleared).toBe(5);
    expect(result.apiAttemptsDeleted).toBe(5);
  });
});

describe('scheduledJobForCron', () => {
  it('maps the cleanup cron to cleanup and everything else to sync', () => {
    expect(scheduledJobForCron(CLEANUP_CRON)).toBe('cleanup');
    expect(scheduledJobForCron('0 20 * * *')).toBe('sync');
    expect(scheduledJobForCron('0 0 * * *')).toBe('sync');
    expect(scheduledJobForCron('')).toBe('sync');
  });
});
