/**
 * migrate-runner.ts — applies packages/api/prisma/migrations/*.sql in order
 * against DATABASE_URL, tracking what already ran in a `schema_migrations`
 * table so it's safe to run again (e.g. every `docker compose up`, against a
 * Postgres volume that already has some or all migrations applied) without
 * re-running (and erroring on) migrations that already succeeded.
 *
 * These migrations were previously only ever applied by hand (see
 * guia_prueba_local.md's history) — there was no tracked, idempotent way to
 * apply them, which is fine for a single manual run but not for a
 * docker-compose service that might start against a pre-existing volume.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

const MIGRATIONS_DIR = join(__dirname, '..', 'prisma', 'migrations');

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required.');
    process.exit(1);
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const pool = new Pool({ connectionString });
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename    TEXT PRIMARY KEY,
         applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );

    const { rows } = await pool.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations',
    );
    const applied = new Set(rows.map((r) => r.filename));

    let ranCount = 0;
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip (already applied): ${file}`);
        continue;
      }
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`applying: ${file}`);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`migration ${file} failed: ${err instanceof Error ? err.message : err}`);
      } finally {
        client.release();
      }
      ranCount += 1;
    }
    console.log(`Migrations applied: ${ranCount} (of ${files.length} total, ${files.length - ranCount} already up to date).`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
