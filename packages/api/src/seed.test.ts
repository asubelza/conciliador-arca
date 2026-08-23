import * as sqlite3 from 'sqlite3';
import { generateSeedRows, generateSeedSql, runSeed } from './seed';

// Portable DDL mirroring prisma/migrations/012_migrate_tipo_to_afip_integer_codes.sql
// so the seed can be executed against an in-memory SQLite database in tests
// (no PG available in this environment). created_at uses CURRENT_TIMESTAMP
// default exactly as the production column default delegates to `now()`.
const DDL = `
CREATE TABLE afip_tipo_map (
  codigo      INTEGER PRIMARY KEY,
  descripcion TEXT NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT 1,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

// The real AFIP tipo integer codes (shared-types AFIP_TIPOS_CADENCIAL) —
// see conciliacion-periodica's stock-historico-comprobantes.spec.md (RF-14)
// for why this replaced the old disconnected zero-padded 3-digit scheme.
// 15/51/81 added 2026-08-23 from a real client ARCA export (see
// shared-types' AFIP_TIPOS_CADENCIAL doc comment).
const EXPECTED: number[] = [1, 2, 3, 6, 7, 8, 11, 12, 13, 15, 19, 20, 21, 51, 81];

function openDb(): sqlite3.Database {
  const db = new sqlite3.Database(':memory:');
  db.exec(DDL, (err) => { if (err) throw err; });
  return db;
}

describe('T03/T15: seed afip_tipo_map with the real AFIP tipo codes', () => {
  let db: sqlite3.Database;

  beforeEach(() => {
    db = openDb();
  });
  afterEach((done) => {
    db.close(() => done());
  });

  it('generateSeedRows returns one row per canonical AFIP code, all activo=true, matching the shared catalogue', () => {
    const rows = generateSeedRows();
    expect(rows).toHaveLength(EXPECTED.length);
    expect(rows.map((r) => r.codigo).sort((a, b) => a - b)).toEqual([...EXPECTED].sort((a, b) => a - b));
    expect(rows.every((r) => r.activo === true)).toBe(true);
    expect(rows.every((r) => r.descripcion.length > 0)).toBe(true);
    // description derived from the shared-types label, not a hardcoded literal
    expect(rows.find((r) => r.codigo === 1)?.descripcion).toContain('FACTURA');
    expect(rows.find((r) => r.codigo === 3)?.descripcion).toContain('NOTA_CREDITO');
  });

  it('generateSeedSql emits one activo=TRUE tuple per code and relies on the created_at column default', () => {
    const sql = generateSeedSql();
    expect(sql).toContain('INSERT INTO afip_tipo_map');
    // created_at omitted -> production PG column default `now()` applies
    expect(sql).not.toMatch(/created_at/);
    expect(sql).toContain('TRUE');
    // exactly one numeric codigo literal per canonical AFIP code, e.g. "(1, "
    for (const codigo of EXPECTED) {
      expect(sql).toContain(`(${codigo}, `);
    }
  });

  it('runSeed inserts exactly one row per canonical code, all activo=true, into the database', async () => {
    const inserted = await runSeed((sql) =>
      new Promise<void>((resolve, reject) => {
        db.exec(sql, (err) => (err ? reject(err) : resolve()));
      }),
    );
    expect(inserted).toBe(EXPECTED.length);

    const rows: Array<{ codigo: number; activo: number }> = await new Promise(
      (resolve, reject) => {
        db.all('SELECT codigo, activo FROM afip_tipo_map ORDER BY codigo', (err, r) =>
          err ? reject(err) : resolve(r as Array<{ codigo: number; activo: number }>),
        );
      },
    );
    expect(rows).toHaveLength(EXPECTED.length);
    // SQLite stores BOOLEAN as 0/1; every seeded row must be true (1)
    expect(rows.every((r) => r.activo === 1)).toBe(true);
    expect(rows.map((r) => r.codigo).sort((a, b) => a - b)).toEqual([...EXPECTED].sort((a, b) => a - b));
  });

  it('re-running the seed on a database that already has the rows fails safely (PK conflict), not a silent duplicate', async () => {
    // codigo is the real table's PRIMARY KEY (012_migrate_tipo_to_afip_integer_codes.sql),
    // so a second insert of the same rows must be rejected by the
    // constraint itself, not merely by application-level idempotency logic
    // (there is none here) — this is the documented, verified real-Postgres
    // behavior from the T15 gap fix: seed-runner.ts's caller
    // (docker-compose.yml's migrate service) wraps this in `|| true`
    // specifically because re-running is expected to fail this way.
    const sql = generateSeedSql();
    const exec = (s: string) =>
      new Promise<void>((resolve, reject) => {
        db.exec(s, (err) => (err ? reject(err) : resolve()));
      });
    await exec(sql);
    await expect(exec(sql)).rejects.toThrow(/UNIQUE constraint failed/);

    const rows: Array<{ codigo: number }> = await new Promise((resolve, reject) => {
      db.all('SELECT codigo FROM afip_tipo_map ORDER BY codigo', (err, r) =>
        err ? reject(err) : resolve(r as Array<{ codigo: number }>),
      );
    });
    // The failed second run must not have partially inserted anything new —
    // still exactly the first run's rows, no duplicates.
    expect(rows.length).toBe(EXPECTED.length);
  });
});
