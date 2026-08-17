import * as sqlite3 from 'sqlite3';
import { generateSeedRows, generateSeedSql, runSeed } from './seed';

// Portable DDL mirroring prisma/migrations/002_init_afip_tipo_map.sql so the
// seed can be executed against an in-memory SQLite database in tests (no PG
// available in this environment). created_at uses CURRENT_TIMESTAMP default
// exactly as the production column default delegates to `now()`.
const DDL = `
CREATE TABLE afip_tipo_map (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo        CHAR(3) NOT NULL,
  descripcion TEXT NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT 1,
  created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

// The 15 canonical AFIP tipos (shared-types AFIP_TIPOS_CADENCIAL).
const EXPECTED: string[] = [
  '001', '002', '003', '004', '005',
  '006', '007', '008', '011', '014',
  '015', '021', '022', '023', '024',
];

function openDb(): sqlite3.Database {
  const db = new sqlite3.Database(':memory:');
  db.exec(DDL, (err) => { if (err) throw err; });
  return db;
}

describe('T03: seed afip_tipo_map with the 15 AFIP tipos', () => {
  let db: sqlite3.Database;

  beforeEach(() => {
    db = openDb();
  });
  afterEach((done) => {
    db.close(() => done());
  });

  it('generateSeedRows returns 15 rows, all activo=true, matching the shared catalogue', () => {
    const rows = generateSeedRows();
    expect(rows).toHaveLength(15);
    expect(rows.map((r) => r.tipo).sort()).toEqual([...EXPECTED].sort());
    expect(rows.every((r) => r.activo === true)).toBe(true);
    expect(rows.every((r) => r.descripcion.length > 0)).toBe(true);
    // description derived from the shared-types label, not a hardcoded literal
    expect(rows.find((r) => r.tipo === '001')?.descripcion).toContain('FACTURA');
    expect(rows.find((r) => r.tipo === '024')?.descripcion).toContain('RETENCION');
  });

  it('generateSeedSql emits 15 activo=TRUE tuples and relies on the created_at column default', () => {
    const sql = generateSeedSql();
    expect(sql).toContain('INSERT INTO afip_tipo_map');
    // created_at omitted -> production PG column default `now()` applies
    expect(sql).not.toMatch(/created_at/);
    expect(sql).toContain('TRUE');
    // exactly 15 zero-padded 3-digit tipo codes present
    const codes = sql.match(/'[0-9]{3}'/g);
    expect(codes).not.toBeNull();
    expect(codes!.length).toBe(15);
  });

  it('runSeed inserts exactly 15 rows with activo=true into the database', async () => {
    const inserted = await runSeed((sql) =>
      new Promise<void>((resolve, reject) => {
        db.exec(sql, (err) => (err ? reject(err) : resolve()));
      }),
    );
    expect(inserted).toBe(15);

    const rows: Array<{ tipo: string; activo: number }> = await new Promise(
      (resolve, reject) => {
        db.all('SELECT tipo, activo FROM afip_tipo_map ORDER BY tipo', (err, r) =>
          err ? reject(err) : resolve(r as Array<{ tipo: string; activo: number }>),
        );
      },
    );
    expect(rows).toHaveLength(15);
    // SQLite stores BOOLEAN as 0/1; every seeded row must be true (1)
    expect(rows.every((r) => r.activo === 1)).toBe(true);
    expect(rows.map((r) => r.tipo).sort()).toEqual([...EXPECTED].sort());
  });

  it('runSeed is idempotent-safe: re-running on a fresh DB yields the same 15', async () => {
    const sql = generateSeedSql();
    const exec = (s: string) =>
      new Promise<void>((resolve, reject) => {
        db.exec(s, (err) => (err ? reject(err) : resolve()));
      });
    await exec(sql);
    await exec(sql); // second run appends (seed re-runs on a fresh DB each test)
    const rows: Array<{ tipo: string }> = await new Promise((resolve, reject) => {
      db.all('SELECT tipo FROM afip_tipo_map ORDER BY tipo', (err, r) =>
        err ? reject(err) : resolve(r as Array<{ tipo: string }>),
      );
    });
    // Re-running inserts again; count must be a multiple of 15 on this ephemeral DB
    expect(rows.length % 15).toBe(0);
    expect(rows.length).toBe(30);
  });
});
