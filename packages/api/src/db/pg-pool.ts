/**
 * pg-pool.ts — shared PostgreSQL connection pool.
 *
 * Single `pg.Pool` instance for the whole API process, built from
 * `DATABASE_URL`. Kept as a thin factory (rather than a NestJS provider with
 * DI magic) so it's trivial to reuse from the BullMQ worker process too,
 * which does not boot the Nest DI container.
 */
import { Pool } from 'pg';

let pool: Pool | undefined;

export function getPgPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

/** Test-only escape hatch: force a fresh pool on the next getPgPool() call. */
export function resetPgPoolForTests(): void {
  pool = undefined;
}
