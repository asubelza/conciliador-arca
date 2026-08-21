/**
 * seed-runner.ts — the actual executable entry point for T03's seed.
 *
 * seed.ts is deliberately DB-agnostic (pure functions, unit-tested against
 * in-memory SQLite — see seed.test.ts) so it has no CLI wiring of its own.
 * `package.json`'s "db:seed": "prisma db seed" never worked: `prisma` itself
 * isn't installed anywhere in this project (schema.prisma exists only as
 * documentation mirroring the SQL migrations, per its own header comment) —
 * running `npm run db:seed` fails immediately with "prisma: not found".
 * This file wires `runSeed` to a real `pg` connection (already a direct
 * dependency of this package) so `npm run seed` actually inserts the 15
 * canonical AFIP tipos into a real PostgreSQL database.
 */
import { Pool } from 'pg';
import { runSeed } from './seed';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  try {
    const inserted = await runSeed(async (sql) => {
      await pool.query(sql);
    });
    console.log(`Seeded ${inserted} afip_tipo_map rows.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
