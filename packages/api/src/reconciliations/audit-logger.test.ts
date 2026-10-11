/**
 * audit-logger.test.ts — T12 (RF-11). Real PostgreSQL: proves rows actually
 * land in `audit_trail` with the right shape, AND — the acceptance
 * criterion that actually matters here (AC4: "audit_log is append-only") —
 * that UPDATE/DELETE are genuinely blocked at the database-privilege level
 * for `app_role`, not just asserted by a structural read of the migration
 * SQL text (see schema.test.ts, which only regex-checks the migration file
 * itself and never touches a live database).
 *
 * `SET ROLE app_role` (rather than a real second `LOGIN` connection) is
 * used to exercise the REVOKE: 000_bootstrap_extensions_and_roles.sql
 * deliberately creates `app_role` as NOLOGIN (granting LOGIN/password is an
 * infra/deploy concern, not a migration's job — see that file's comment),
 * and PostgreSQL lets a superuser `SET ROLE` to any role regardless of
 * membership, so this test can adopt app_role's privileges for one
 * statement without needing that infra.
 */
import { Pool } from 'pg';
import { logAuditEvent } from './audit-logger';
import { createTestTenant, deleteTestTenant } from '../test-support/pg-test-helpers';

describe('T12 RF-11: logAuditEvent', () => {
  let pool: Pool;
  let tenantId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    tenantId = await createTestTenant(pool, 'audit-logger.test');
  });

  afterAll(async () => {
    await deleteTestTenant(pool, tenantId);
    await pool.end();
  });

  it('inserts a row with the given action/entity/details and returns it', async () => {
    const row = await logAuditEvent(pool, {
      tenantId,
      userId: null,
      action: 'upload',
      entity: 'reconciliation_job',
      entityId: '11111111-1111-1111-1111-111111111111',
      details: { rows: 42 },
    });

    expect(row.tenant_id).toBe(tenantId);
    expect(row.action).toBe('upload');
    expect(row.entity).toBe('reconciliation_job');
    expect(row.entity_id).toBe('11111111-1111-1111-1111-111111111111');
    expect(row.details).toEqual({ rows: 42 });

    const { rows } = await pool.query('SELECT * FROM audit_trail WHERE id = $1', [row.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe(tenantId);
  });

  it('defaults userId/entity/entityId/details to NULL when omitted', async () => {
    const row = await logAuditEvent(pool, { tenantId, action: 'match' });
    expect(row.user_id).toBeNull();
    expect(row.entity).toBeNull();
    expect(row.entity_id).toBeNull();
    expect(row.details).toBeNull();
  });

  /**
   * Runs one statement as app_role, inside its own BEGIN/ROLLBACK — a failed
   * statement aborts the rest of its transaction, so UPDATE and DELETE each
   * need their own connection/transaction rather than sharing one (the first
   * failure would otherwise mask the second behind a generic "current
   * transaction is aborted" error instead of a real permission check).
   */
  async function runAsAppRole(sql: string, params: unknown[]): Promise<unknown> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // app_role is subject to the tenant_isolation RLS policy (007_enable_
      // rls.sql) — app.tenant_id must be set for app_role's statements to
      // resolve any rows at all, independent of the REVOKE this test
      // targets.
      await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
      await client.query('SET ROLE app_role');
      return await client.query(sql, params);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  it('AC4: audit_trail is append-only — app_role cannot UPDATE or DELETE it', async () => {
    const row = await logAuditEvent(pool, { tenantId, action: 'export', details: { rows: 1 } });

    await expect(
      runAsAppRole('UPDATE audit_trail SET action = $1 WHERE id = $2', ['tampered', row.id]),
    ).rejects.toThrow(/permission denied/i);

    await expect(runAsAppRole('DELETE FROM audit_trail WHERE id = $1', [row.id])).rejects.toThrow(
      /permission denied/i,
    );

    // Row is still there, untouched, proving the REVOKE actually held.
    const { rows } = await pool.query('SELECT action FROM audit_trail WHERE id = $1', [row.id]);
    expect(rows[0].action).toBe('export');
  });

  it('AC4 (control): app_role CAN still INSERT (only UPDATE/DELETE are revoked)', async () => {
    await expect(
      runAsAppRole(`INSERT INTO audit_trail (tenant_id, action) VALUES ($1, $2) RETURNING id`, [tenantId, 'upload']),
    ).resolves.toBeTruthy();
  });
});
