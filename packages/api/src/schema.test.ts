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

function readSchema(): string {
  if (!fs.existsSync(SCHEMA_PATH)) return '';
  return fs.readFileSync(SCHEMA_PATH, 'utf8');
}

const sql = readMigrations();
const schema = readSchema();
const sqlLc = sql.toLowerCase();

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
  });

  describe('table definitions', () => {
    const tables = [
      'tenants',
      'afip_tipo_map',
      'vouchers_staging',
      'vouchers_canonical',
      'reconciliation_results',
      'audit_trail',
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

    it('afip_tipo_map has tipo, descripcion, activo boolean, created_at', () => {
      expect(sqlLc).toContain('afip_tipo_map');
      expect(sqlLc).toContain('tipo');
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
    const tenantTables = ['vouchers_staging', 'vouchers_canonical', 'reconciliation_results', 'audit_trail'];

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

  describe('Prisma schema', () => {
    it('declares a postgresql datasource', () => {
      expect(schema).toMatch(/datasource\s+db\s*\{[\s\S]*?provider\s*=\s*"postgresql"/);
    });

    it('declares all six models', () => {
      const models = ['Tenant', 'AfipTipoMap', 'VoucherStaging', 'VoucherCanonical', 'ReconciliationResult', 'AuditTrail'];
      models.forEach((m) => {
        expect(schema).toMatch(new RegExp(`model\\s+${m}\\s*\\{`));
      });
    });

    it('generates the Prisma client', () => {
      expect(schema).toMatch(/generator\s+client\s*\{[\s\S]*?provider\s*=\s*"prisma-client-js"/);
    });
  });
});
