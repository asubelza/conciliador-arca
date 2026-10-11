/**
 * app-role-grants.test.ts — verifies migrations
 * 017_grant_app_role_remaining_tables.sql and (dashboard-principal, RF-40)
 * 023_grant_app_role_delete_periodos.sql against real PostgreSQL.
 *
 * Closes the gap flagged since PR-3's 011_grant_app_role_audit_feedback.sql:
 * every table besides audit_trail/feedback_loop had zero GRANTs for
 * app_role, invisible in every migration/test/dev session because they all
 * connect as the superuser (`conciliador`), which bypasses privilege checks
 * entirely. Same `SET ROLE app_role` technique as audit-logger.test.ts and
 * periodo-cierre.test.ts's own app_role test: 000_bootstrap_extensions_and_
 * roles.sql creates app_role NOLOGIN, and a superuser can SET ROLE to any
 * role regardless of membership, so no separate LOGIN/password
 * infrastructure is needed to exercise the grants for real.
 *
 * Every statement below mirrors an actual statement the running app code
 * issues (see 017's own module comment for the file:line justification per
 * grant; 023's two DELETE grants are justified by reabrirPeriodo()'s
 * snapshot DELETE and eliminarPeriodo()'s row DELETE) — this test proves
 * both halves of least-privilege: the intended grants work, AND everything
 * not explicitly granted is genuinely denied with "permission denied", not
 * merely absent from the migration text.
 */
import { Pool } from 'pg';
import { createTestPeriodo, createTestTenant, deleteTestTenant } from './test-support/pg-test-helpers';

describe('017_grant_app_role_remaining_tables: real privilege checks', () => {
  let pool: Pool;
  let tenantId: string;
  let periodoId: string;
  let voucherId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    tenantId = await createTestTenant(pool, 'app_role grants test tenant');
    periodoId = await createTestPeriodo(pool, tenantId, '2026-02-01');
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO vouchers_canonical (
         tenant_id, cuit_emisor, tipo_cbte, punto_venta, numero, importe_total,
         file_source, estado, periodo_alta_id
       ) VALUES ($1, '30111111112', 1, 1, 100, 1000, 'arca', 'pendiente', $2)
       RETURNING id`,
      [tenantId, periodoId],
    );
    voucherId = rows[0].id;
  });

  afterEach(async () => {
    await deleteTestTenant(pool, tenantId);
  });

  /**
   * Same shape as audit-logger.test.ts's runAsAppRole: one statement per
   * BEGIN/ROLLBACK (a failed statement aborts the rest of its transaction),
   * with app.tenant_id set first because app_role is also subject to the
   * tenant_isolation RLS policy — without it, app_role's queries resolve
   * zero rows regardless of the privilege being tested, which would make a
   * "permission denied" assertion pass for the wrong reason.
   */
  async function runAsAppRole(sql: string, params: unknown[]): Promise<unknown> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
      await client.query('SET ROLE app_role');
      return await client.query(sql, params);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  describe('tenants: SELECT, UPDATE granted; no INSERT/DELETE', () => {
    it('app_role can SELECT and UPDATE tolerancia_redondeo_ars', async () => {
      await expect(runAsAppRole('SELECT tolerancia_redondeo_ars FROM tenants WHERE id = $1', [tenantId])).resolves.toBeTruthy();
      await expect(
        runAsAppRole('UPDATE tenants SET tolerancia_redondeo_ars = $1 WHERE id = $2', [1.5, tenantId]),
      ).resolves.toBeTruthy();
    });

    it('app_role cannot INSERT or DELETE tenants (provisioning is out-of-band)', async () => {
      await expect(runAsAppRole('INSERT INTO tenants (name) VALUES ($1)', ['rogue tenant'])).rejects.toThrow(
        /permission denied/i,
      );
      await expect(runAsAppRole('DELETE FROM tenants WHERE id = $1', [tenantId])).rejects.toThrow(/permission denied/i);
    });
  });

  describe('vouchers_staging: SELECT, INSERT granted; no UPDATE/DELETE', () => {
    it('app_role can SELECT and INSERT (COPY FROM STDIN requires the same INSERT privilege)', async () => {
      await expect(
        runAsAppRole(`INSERT INTO vouchers_staging (tenant_id, raw_data, file_source) VALUES ($1, '{}'::jsonb, 'arca') RETURNING id`, [
          tenantId,
        ]),
      ).resolves.toBeTruthy();
      await expect(runAsAppRole('SELECT id FROM vouchers_staging WHERE tenant_id = $1', [tenantId])).resolves.toBeTruthy();
    });

    it('app_role cannot UPDATE or DELETE vouchers_staging', async () => {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO vouchers_staging (tenant_id, raw_data, file_source) VALUES ($1, '{}'::jsonb, 'arca') RETURNING id`,
        [tenantId],
      );
      const stagingId = rows[0].id;
      await expect(runAsAppRole('UPDATE vouchers_staging SET file_source = $1 WHERE id = $2', ['contabilidad', stagingId])).rejects.toThrow(
        /permission denied/i,
      );
      await expect(runAsAppRole('DELETE FROM vouchers_staging WHERE id = $1', [stagingId])).rejects.toThrow(/permission denied/i);
    });
  });

  describe('vouchers_canonical: SELECT, INSERT, UPDATE granted; no DELETE', () => {
    it('app_role can SELECT, INSERT, and UPDATE (upsert needs both)', async () => {
      await expect(runAsAppRole('SELECT id FROM vouchers_canonical WHERE id = $1', [voucherId])).resolves.toBeTruthy();
      await expect(
        runAsAppRole(
          `INSERT INTO vouchers_canonical (
             tenant_id, cuit_emisor, tipo_cbte, punto_venta, numero, importe_total,
             file_source, estado, periodo_alta_id
           ) VALUES ($1, '30111111113', 1, 1, 200, 500, 'contabilidad', 'pendiente', $2)
           RETURNING id`,
          [tenantId, periodoId],
        ),
      ).resolves.toBeTruthy();
      await expect(
        runAsAppRole(`UPDATE vouchers_canonical SET estado = 'conciliado', periodo_cierre_id = $1 WHERE id = $2`, [periodoId, voucherId]),
      ).resolves.toBeTruthy();
    });

    it('app_role cannot DELETE vouchers_canonical', async () => {
      await expect(runAsAppRole('DELETE FROM vouchers_canonical WHERE id = $1', [voucherId])).rejects.toThrow(/permission denied/i);
    });
  });

  describe('reconciliation_results: SELECT, INSERT granted; no UPDATE/DELETE', () => {
    it('app_role can SELECT and INSERT (COPY FROM STDIN requires the same INSERT privilege)', async () => {
      await expect(
        runAsAppRole(
          `INSERT INTO reconciliation_results (tenant_id, tipo_clasificacion, iva_impacto) VALUES ($1, 'matched', 10) RETURNING id`,
          [tenantId],
        ),
      ).resolves.toBeTruthy();
      await expect(runAsAppRole('SELECT id FROM reconciliation_results WHERE tenant_id = $1', [tenantId])).resolves.toBeTruthy();
    });

    it('app_role cannot UPDATE or DELETE reconciliation_results (write-once, same posture as periodo_resultados)', async () => {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO reconciliation_results (tenant_id, tipo_clasificacion, iva_impacto) VALUES ($1, 'matched', 10) RETURNING id`,
        [tenantId],
      );
      const resultId = rows[0].id;
      await expect(
        runAsAppRole("UPDATE reconciliation_results SET tipo_clasificacion = 'errors' WHERE id = $1", [resultId]),
      ).rejects.toThrow(/permission denied/i);
      await expect(runAsAppRole('DELETE FROM reconciliation_results WHERE id = $1', [resultId])).rejects.toThrow(/permission denied/i);
    });
  });

  describe('periodos: SELECT, INSERT, UPDATE granted (017); DELETE granted by 023 (RF-40)', () => {
    it('app_role can SELECT, INSERT, and SELECT ... FOR UPDATE (row-lock read requires UPDATE privilege)', async () => {
      await expect(runAsAppRole('SELECT id FROM periodos WHERE id = $1', [periodoId])).resolves.toBeTruthy();
      await expect(
        runAsAppRole("INSERT INTO periodos (tenant_id, mes) VALUES ($1, '2026-03-01'::date) RETURNING id", [tenantId]),
      ).resolves.toBeTruthy();
      await expect(runAsAppRole('SELECT id FROM periodos WHERE id = $1 FOR UPDATE', [periodoId])).resolves.toBeTruthy();
    });

    it('app_role can UPDATE periodos (cierre)', async () => {
      await expect(
        runAsAppRole("UPDATE periodos SET estado = 'cerrado', cerrado_at = now() WHERE id = $1", [periodoId]),
      ).resolves.toBeTruthy();
    });

    it('app_role can DELETE periodos — exactly eliminarPeriodo()\'s own statement (023, RF-36)', async () => {
      // A fresh período with nothing referencing it — the same precondition
      // eliminarPeriodo()'s zero-reference guard establishes before issuing
      // this exact DELETE (deleting the shared fixture row would rightly
      // trip vouchers_canonical's FK instead).
      const { rows: emptyRows } = await pool.query<{ id: string }>(
        "INSERT INTO periodos (tenant_id, mes) VALUES ($1, '2026-04-01'::date) RETURNING id",
        [tenantId],
      );
      await expect(runAsAppRole('DELETE FROM periodos WHERE id = $1', [emptyRows[0].id])).resolves.toBeTruthy();
    });
  });

  describe('periodo_resultados: SELECT, INSERT granted (017); DELETE granted by 023, UPDATE stays revoked (RF-40)', () => {
    it('app_role can SELECT and INSERT the frozen snapshot', async () => {
      await expect(
        runAsAppRole(
          `INSERT INTO periodo_resultados (tenant_id, periodo_id, classification, composite_key)
           VALUES ($1, $2, 'conciliado_ok', 'k1') RETURNING id`,
          [tenantId, periodoId],
        ),
      ).resolves.toBeTruthy();
      await expect(runAsAppRole('SELECT id FROM periodo_resultados WHERE periodo_id = $1', [periodoId])).resolves.toBeTruthy();
    });

    it('app_role still cannot UPDATE periodo_resultados (016\'s REVOKE is unchanged — the append-only guarantee keeps its one audited exception: reopen deletes whole rows, never rewrites them)', async () => {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO periodo_resultados (tenant_id, periodo_id, classification, composite_key)
         VALUES ($1, $2, 'conciliado_ok', 'k1') RETURNING id`,
        [tenantId, periodoId],
      );
      const resultadoId = rows[0].id;
      await expect(
        runAsAppRole("UPDATE periodo_resultados SET classification = 'con_divergencia' WHERE id = $1", [resultadoId]),
      ).rejects.toThrow(/permission denied/i);
    });

    it('app_role can DELETE periodo_resultados rows — exactly reabrirPeriodo()\'s own statement (023, RF-33)', async () => {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO periodo_resultados (tenant_id, periodo_id, classification, composite_key)
         VALUES ($1, $2, 'conciliado_ok', 'k1') RETURNING id`,
        [tenantId, periodoId],
      );
      const resultadoId = rows[0].id;
      // The reopen path's exact statement (periodo-reapertura.ts scopes it
      // by periodo_id; the privilege being proven is table-level anyway).
      await expect(runAsAppRole('DELETE FROM periodo_resultados WHERE id = $1', [resultadoId])).resolves.toBeTruthy();
      await expect(runAsAppRole('DELETE FROM periodo_resultados WHERE periodo_id = $1', [periodoId])).resolves.toBeTruthy();
    });
  });

  describe('018: users SELECT+INSERT+UPDATE granted; no DELETE (T33/T34, autenticacion-roles)', () => {
    it('app_role can SELECT, INSERT, and UPDATE users (no RLS on this table — see migration 018)', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET ROLE app_role');
        const { rows } = await client.query(
          `INSERT INTO users (email, password_hash, role) VALUES ($1, 'hash', 'admin') RETURNING id`,
          [`app-role-grants-test-${Date.now()}@example.com`],
        );
        await expect(client.query('SELECT id FROM users WHERE id = $1', [rows[0].id])).resolves.toBeTruthy();
        await expect(
          client.query('UPDATE users SET display_name = $1 WHERE id = $2', ['Nombre', rows[0].id]),
        ).resolves.toBeTruthy();
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    });

    it('app_role cannot DELETE users (deactivate via is_active instead)', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          `INSERT INTO users (email, password_hash, role) VALUES ($1, 'hash', 'admin') RETURNING id`,
          [`app-role-grants-test-del-${Date.now()}@example.com`],
        );
        await client.query('SET ROLE app_role');
        await expect(client.query('DELETE FROM users WHERE id = $1', [rows[0].id])).rejects.toThrow(/permission denied/i);
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    });
  });

  describe('018: user_tenant_access SELECT+INSERT+DELETE granted (T33, autenticacion-roles)', () => {
    it('app_role can SELECT, INSERT, and DELETE user_tenant_access rows', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: userRows } = await client.query(
          `INSERT INTO users (email, password_hash, role) VALUES ($1, 'hash', 'cliente') RETURNING id`,
          [`app-role-grants-test-uta-${Date.now()}@example.com`],
        );
        await client.query('SET ROLE app_role');
        await expect(
          client.query('INSERT INTO user_tenant_access (user_id, tenant_id) VALUES ($1, $2)', [userRows[0].id, tenantId]),
        ).resolves.toBeTruthy();
        await expect(
          client.query('SELECT * FROM user_tenant_access WHERE user_id = $1', [userRows[0].id]),
        ).resolves.toBeTruthy();
        await expect(
          client.query('DELETE FROM user_tenant_access WHERE user_id = $1', [userRows[0].id]),
        ).resolves.toBeTruthy();
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    });
  });

  describe('afip_tipo_map: deliberately not granted anything', () => {
    it('app_role cannot even SELECT afip_tipo_map (the app never queries it at request time — see afip-tipo-lookup.ts)', async () => {
      await expect(runAsAppRole('SELECT codigo FROM afip_tipo_map LIMIT 1', [])).rejects.toThrow(/permission denied/i);
    });
  });
});
