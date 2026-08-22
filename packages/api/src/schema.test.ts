import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations');
const SCHEMA_PATH = path.join(__dirname, '..', 'prisma', 'schema.prisma');

/**
 * Reads every migration .sql file (sorted) and concatenates them into one string
 * so structural assertions can verify the full schema is declared.
 *
 * NOTE (documented risk): This environment has no PostgreSQL instance, so full
 * ROLLBACK execution of PG-specific DDL (uuid, jsonb, gen_random_uuid(), RLS)
 * is not possible here. SQLite cannot parse CREATE POLICY / ENABLE ROW LEVEL
 * SECURITY / REVOKE, so we verify the migration *definitions* contain the
 * required guards — the verify phase runs execution smoke against managed PG.
 */
function readMigrations(): string {
  if (!fs.existsSync(MIGRATIONS_DIR)) return '';
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n');
}

/**
 * Strips `-- ...` line comments before ordering checks, so a comment that
 * merely *mentions* a keyword (e.g. explaining why gen_random_uuid() needs
 * pgcrypto) can't be mistaken for the real statement when asserting
 * statement order across migration files.
 */
function stripSqlComments(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

function readSchema(): string {
  if (!fs.existsSync(SCHEMA_PATH)) return '';
  return fs.readFileSync(SCHEMA_PATH, 'utf8');
}

const sql = readMigrations();
const schema = readSchema();
const sqlLc = sql.toLowerCase();
const sqlLcNoComments = stripSqlComments(sql).toLowerCase();

describe('T02: Prisma schema + migrations with RLS (multi-tenant)', () => {
  describe('migrations exist', () => {
    const files = fs.existsSync(MIGRATIONS_DIR)
      ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))
      : [];

    it('defines a migration for tenants', () => {
      expect(files.some((f) => /tenants/.test(f))).toBe(true);
    });
    it('defines a migration for afip_tipo_map', () => {
      expect(files.some((f) => /afip_tipo_map/.test(f))).toBe(true);
    });
    it('defines a migration for vouchers_staging', () => {
      expect(files.some((f) => /staging/.test(f))).toBe(true);
    });
    it('defines a migration for vouchers_canonical', () => {
      expect(files.some((f) => /canonical/.test(f))).toBe(true);
    });
    it('defines a migration for reconciliation_results', () => {
      expect(files.some((f) => /reconciliation/.test(f))).toBe(true);
    });
    it('defines a migration for audit_trail', () => {
      expect(files.some((f) => /audit/.test(f))).toBe(true);
    });
    it('defines a migration for periodos (conciliacion-periodica T16)', () => {
      expect(files.some((f) => /periodos/.test(f))).toBe(true);
    });
  });

  describe('table definitions', () => {
    const tables = [
      'tenants',
      'afip_tipo_map',
      'vouchers_staging',
      'vouchers_canonical',
      'reconciliation_results',
      'audit_trail',
      'periodos',
    ];

    tables.forEach((t) => {
      it(`creates table "${t}"`, () => {
        expect(sqlLc).toMatch(new RegExp(`create\\s+table\\s+\\b${t}\\b`));
      });
    });

    it('tenants has id, name, cuit, created_at, updated_at', () => {
      expect(sqlLc).toContain('tenants');
      expect(sqlLc).toContain('cuit');
      expect(sqlLc).toContain('created_at');
      expect(sqlLc).toContain('updated_at');
    });

    it('afip_tipo_map has codigo (real AFIP integer, T14), descripcion, activo boolean, created_at', () => {
      expect(sqlLc).toContain('afip_tipo_map');
      expect(sqlLc).toContain('codigo');
      expect(sqlLc).toContain('descripcion');
      expect(sqlLc).toContain('activo');
      expect(sqlLc).toContain('boolean');
    });

    it('vouchers_staging has tenant_id FK to tenants and raw_data jsonb', () => {
      expect(sqlLc).toContain('vouchers_staging');
      expect(sqlLc).toContain('raw_data');
      expect(sqlLc).toContain('jsonb');
      expect(sqlLc).toMatch(/references\s+tenants\s*\(id\)/);
    });

    it('vouchers_canonical has tipo, cuit_emisor, punto_venta, numero, importe_total, iva', () => {
      expect(sqlLc).toContain('vouchers_canonical');
      expect(sqlLc).toContain('cuit_emisor');
      expect(sqlLc).toContain('punto_venta');
      expect(sqlLc).toContain('importe_total');
      expect(sqlLc).toContain('tipo');
      expect(sqlLc).toContain('numero');
      expect(sqlLc).toContain('iva');
    });

    it('reconciliation_results references vouchers_canonical and has tipo_clasificacion', () => {
      expect(sqlLc).toContain('reconciliation_results');
      expect(sqlLc).toMatch(/references\s+vouchers_canonical\s*\(/);
      expect(sqlLc).toContain('tipo_clasificacion');
      expect(sqlLc).toContain('iva_impacto');
    });

    it('audit_trail has action, entity, entity_id, details jsonb', () => {
      expect(sqlLc).toContain('audit_trail');
      expect(sqlLc).toContain('action');
      expect(sqlLc).toContain('entity');
      expect(sqlLc).toContain('entity_id');
      expect(sqlLc).toContain('details');
    });

    it('periodos has tenant_id FK, mes, estado, tolerancia_ars, cerrado_at/cerrado_por, UNIQUE(tenant_id, mes) (T16, RF-12)', () => {
      expect(sqlLc).toContain('periodos');
      expect(sqlLc).toContain('mes');
      expect(sqlLc).toContain('estado');
      expect(sqlLc).toContain('tolerancia_ars');
      expect(sqlLc).toContain('cerrado_at');
      expect(sqlLc).toContain('cerrado_por');
      expect(sqlLc).toMatch(/references\s+tenants\s*\(id\)/);
      expect(sqlLc).toMatch(/unique\s*\(\s*tenant_id\s*,\s*mes\s*\)/);
    });

    it('tenants has tolerancia_redondeo_ars, default 0.99 (T17, RF-18)', () => {
      expect(sqlLc).toContain('tolerancia_redondeo_ars');
      expect(sqlLc).toMatch(/tolerancia_redondeo_ars\s+numeric\(10,\s*2\)\s+not\s+null\s+default\s+0\.99/);
    });

    it('vouchers_canonical gains estado, periodo_alta_id, periodo_cierre_id + a unique composite-key index (T21, RF-15/RF-16)', () => {
      expect(sqlLc).toMatch(/estado\s+text\s+not\s+null\s+default\s+'pendiente'/);
      expect(sqlLc).toContain('periodo_alta_id');
      expect(sqlLc).toContain('periodo_cierre_id');
      expect(sqlLc).toMatch(/create\s+unique\s+index\s+idx_vouchers_tenant_key_unique/);
      expect(sqlLc).toMatch(/idx_vouchers_tenant_key_unique\s+on\s+vouchers_canonical\s*\(\s*tenant_id\s*,\s*file_source\s*,\s*cuit_emisor\s*,\s*tipo_cbte\s*,\s*punto_venta\s*,\s*numero\s*\)/);
    });
  });

  describe('indexes', () => {
    it('defines the compound lookup index idx_vouchers_tenant_key', () => {
      expect(sqlLc).toContain('idx_vouchers_tenant_key');
      expect(sqlLc).toMatch(/create\s+index\s+idx_vouchers_tenant_key/);
      expect(sqlLc).toContain('tenant_id');
      expect(sqlLc).toContain('cuit_emisor');
      expect(sqlLc).toContain('punto_venta');
    });

    it('defines a tenant_id index on reconciliation_results', () => {
      expect(sqlLc).toMatch(/create\s+index\s+idx_recon_tenant/);
      expect(sqlLc).toContain('reconciliation_results');
    });

    it('defines a tenant_id index on audit_trail', () => {
      expect(sqlLc).toMatch(/create\s+index\s+idx_audit_tenant/);
      expect(sqlLc).toContain('audit_trail');
    });
  });

  describe('row-level security (backstop tenant isolation)', () => {
    const tenantTables = [
      'vouchers_staging',
      'vouchers_canonical',
      'reconciliation_results',
      'audit_trail',
      'periodos',
    ];

    tenantTables.forEach((t) => {
      it(`enables RLS on "${t}"`, () => {
        expect(sqlLc).toMatch(new RegExp(`alter\\s+table\\s+${t}\\s+enable\\s+row\\s+level\\s+security`));
      });

      it(`creates tenant_isolation policy on "${t}"`, () => {
        expect(sqlLc).toMatch(new RegExp(`create\\s+policy\\s+.*"tenant_isolation".*on\\s+${t}`));
        expect(sqlLc).toContain("current_setting('app.tenant_id')::uuid");
      });
    });

    it('audit_trail is append-only (UPDATE/DELETE revoked from app role)', () => {
      expect(sqlLc).toMatch(/revoke\s+update\s*,\s*delete\s+on\s+audit_trail/);
    });
  });

  describe('bootstrap prerequisites (000): pgcrypto + app_role', () => {
    // Found during PR-1 review: 007 REVOKEs on app_role and every table PK
    // defaults to gen_random_uuid() (pgcrypto), but nothing created either
    // one — this fails on a fresh PostgreSQL instance with
    // "role app_role does not exist" / "function gen_random_uuid() does not
    // exist". A migration numbered before 001 must provision both.
    const files = fs.existsSync(MIGRATIONS_DIR)
      ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
      : [];

    it('defines a migration that sorts before 001_init_tenants', () => {
      const bootstrap = files.find((f) => /^000/.test(f));
      expect(bootstrap).toBeDefined();
      expect(files.indexOf(bootstrap as string)).toBeLessThan(
        files.indexOf('001_init_tenants.sql'),
      );
    });

    it('enables the pgcrypto extension (required by gen_random_uuid() defaults)', () => {
      expect(sqlLc).toMatch(/create\s+extension\s+if\s+not\s+exists\s+pgcrypto/);
    });

    it('creates app_role before 007 revokes privileges from it', () => {
      const createIdx = sqlLcNoComments.search(/create\s+role\s+app_role/);
      const revokeIdx = sqlLcNoComments.search(/revoke\s+update\s*,\s*delete\s+on\s+audit_trail\s+from\s+app_role/);
      expect(createIdx).toBeGreaterThan(-1);
      expect(revokeIdx).toBeGreaterThan(-1);
      expect(createIdx).toBeLessThan(revokeIdx);
    });

    it('pgcrypto extension is declared before the first gen_random_uuid() default', () => {
      const extensionIdx = sqlLcNoComments.search(/create\s+extension\s+if\s+not\s+exists\s+pgcrypto/);
      const firstUsageIdx = sqlLcNoComments.search(/gen_random_uuid\(\)/);
      expect(extensionIdx).toBeGreaterThan(-1);
      expect(firstUsageIdx).toBeGreaterThan(-1);
      expect(extensionIdx).toBeLessThan(firstUsageIdx);
    });
  });

  describe('Prisma schema', () => {
    it('declares a postgresql datasource', () => {
      expect(schema).toMatch(/datasource\s+db\s*\{[\s\S]*?provider\s*=\s*"postgresql"/);
    });

    it('declares all seven models', () => {
      const models = [
        'Tenant',
        'AfipTipoMap',
        'VoucherStaging',
        'VoucherCanonical',
        'ReconciliationResult',
        'AuditTrail',
        'Periodo',
      ];
      models.forEach((m) => {
        expect(schema).toMatch(new RegExp(`model\\s+${m}\\s*\\{`));
      });
    });

    it('generates the Prisma client', () => {
      expect(schema).toMatch(/generator\s+client\s*\{[\s\S]*?provider\s*=\s*"prisma-client-js"/);
    });
  });
});
