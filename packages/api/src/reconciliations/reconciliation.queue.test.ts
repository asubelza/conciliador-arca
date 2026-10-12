/**
 * reconciliation.queue.test.ts — construction/wiring tests for the BullMQ
 * queue the upload controller enqueues into and the worker consumes from
 * (previously zero test coverage — PR review finding #7).
 *
 * Also documents the finding #7/#8-adjacent "duplicate upload" behavior:
 * there is no content-based dedup/idempotency key anywhere in this module
 * or its caller (reconciliations.controller.ts) — only the caller-supplied
 * `jobId` (a fresh `randomUUID()` per request). This test proves/documents
 * that actual current behavior rather than inventing a dedup feature.
 */
import { randomUUID } from 'crypto';
import {
  RECONCILIATION_QUEUE_NAME,
  getReconciliationQueue,
  getRedisConnectionOptions,
  resetReconciliationQueueForTests,
} from './reconciliation.queue';

describe('reconciliation.queue', () => {
  // Every test either closes the queue instance it created itself, or we
  // close+reset here as a safety net — so no test leaks an open Redis
  // connection into the next one (the same class of leak as finding #4,
  // just for Redis instead of a file handle).
  afterEach(async () => {
    try {
      await getReconciliationQueue().close();
    } catch {
      // Already closed by the test itself — nothing more to do.
    }
    resetReconciliationQueueForTests();
  });

  it('exposes the queue name shared by the controller and the worker', () => {
    expect(RECONCILIATION_QUEUE_NAME).toBe('reconciliations');
  });

  describe('getRedisConnectionOptions', () => {
    const originalHost = process.env.REDIS_HOST;
    const originalPort = process.env.REDIS_PORT;

    afterEach(() => {
      if (originalHost === undefined) delete process.env.REDIS_HOST;
      else process.env.REDIS_HOST = originalHost;
      if (originalPort === undefined) delete process.env.REDIS_PORT;
      else process.env.REDIS_PORT = originalPort;
    });

    it('defaults to localhost:6379 when REDIS_HOST/REDIS_PORT are unset', () => {
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;
      expect(getRedisConnectionOptions()).toEqual({ host: 'localhost', port: 6379 });
    });

    it('honors REDIS_HOST/REDIS_PORT overrides', () => {
      process.env.REDIS_HOST = 'redis.internal';
      process.env.REDIS_PORT = '7000';
      expect(getRedisConnectionOptions()).toEqual({ host: 'redis.internal', port: 7000 });
    });
  });

  it('getReconciliationQueue returns the same instance on repeated calls', () => {
    const a = getReconciliationQueue();
    const b = getReconciliationQueue();
    expect(a).toBe(b);
  });

  it('resetReconciliationQueueForTests forces a fresh instance on the next call', async () => {
    const a = getReconciliationQueue();
    await a.close();
    resetReconciliationQueueForTests();

    const b = getReconciliationQueue();
    expect(b).not.toBe(a);
  });

  it('duplicate-upload / idempotency: resubmitting the same file content creates two independent jobs', async () => {
    // reconciliations.controller.ts generates a fresh randomUUID() per
    // request and passes only { jobId, attempts, backoff } as job
    // options — nothing derived from file content or tenant_id. So "the
    // same upload submitted twice" is, at the queue level, indistinguishable
    // from two unrelated uploads: both get staged independently.
    const queue = getReconciliationQueue();
    const sameData = {
      tenantId: '00000000-0000-0000-0000-000000000000',
      arca: { filePath: '/tmp/a.csv', originalName: 'a.csv', extension: 'csv' as const },
      contabilidad: { filePath: '/tmp/b.csv', originalName: 'b.csv', extension: 'csv' as const },
    };
    const jobIdA = randomUUID();
    const jobIdB = randomUUID();

    await queue.add('stage-and-normalize', sameData, { jobId: jobIdA });
    await queue.add('stage-and-normalize', sameData, { jobId: jobIdB });

    const jobA = await queue.getJob(jobIdA);
    const jobB = await queue.getJob(jobIdB);

    expect(jobA).toBeDefined();
    expect(jobB).toBeDefined();
    expect(jobA!.id).not.toBe(jobB!.id);
    expect(jobA!.data).toEqual(sameData);
    expect(jobB!.data).toEqual(sameData);

    await jobA?.remove();
    await jobB?.remove();
  });

  it('new job options include retry attempts + backoff (finding #8)', async () => {
    const queue = getReconciliationQueue();
    const jobId = randomUUID();
    const data = {
      tenantId: '00000000-0000-0000-0000-000000000000',
      arca: { filePath: '/tmp/a.csv', originalName: 'a.csv', extension: 'csv' as const },
      contabilidad: { filePath: '/tmp/b.csv', originalName: 'b.csv', extension: 'csv' as const },
    };
    await queue.add('stage-and-normalize', data, {
      jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });

    const job = await queue.getJob(jobId);
    expect(job?.opts.attempts).toBe(3);
    expect(job?.opts.backoff).toEqual({ type: 'exponential', delay: 2000 });

    await job?.remove();
  });
});
