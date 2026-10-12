/**
 * feedback-writer.ts — T12 (RF-11): persists a user mark into
 * `feedback_loop` (010_init_feedback_loop.sql).
 */
import type { Pool } from 'pg';
import type { MarkRequestBody } from './marks-validation';

export interface FeedbackLoopRow {
  id: string;
  tenant_id: string;
  user_id: string | null;
  composite_key: string;
  classification: string;
  note: string | null;
  created_at: string;
}

export async function insertFeedbackMark(
  pool: Pool,
  tenantId: string,
  mark: MarkRequestBody,
): Promise<FeedbackLoopRow> {
  const { rows } = await pool.query<FeedbackLoopRow>(
    `INSERT INTO feedback_loop (tenant_id, user_id, composite_key, classification, note)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, tenant_id, user_id, composite_key, classification, note, created_at`,
    [tenantId, mark.user_id, mark.composite_key, mark.classification, mark.note],
  );
  return rows[0];
}

/**
 * RF-11's "Feedback loop persists for future matching" scenario: the
 * matching engine CAN read `feedback_loop` to apply learned exclusions.
 * Scope note: T12 only wires the read-back + `audit_trail` 'feedback_read'
 * logging that scenario requires; actually consulting these marks from
 * inside reconciliation-engine.ts's matching logic to change which
 * vouchers get excluded is a further T09 change with no acceptance
 * criterion in RF-11's AC list (1-6) requiring it — out of scope for this
 * (S-sized) task, same kind of deliberate scope line drawn for
 * vouchers_canonical in 009's migration comment.
 */
export async function readFeedbackLoop(pool: Pool, tenantId: string, compositeKey?: string): Promise<FeedbackLoopRow[]> {
  if (compositeKey) {
    const { rows } = await pool.query<FeedbackLoopRow>(
      `SELECT id, tenant_id, user_id, composite_key, classification, note, created_at
         FROM feedback_loop
        WHERE tenant_id = $1 AND composite_key = $2
        ORDER BY created_at DESC`,
      [tenantId, compositeKey],
    );
    return rows;
  }
  const { rows } = await pool.query<FeedbackLoopRow>(
    `SELECT id, tenant_id, user_id, composite_key, classification, note, created_at
       FROM feedback_loop
      WHERE tenant_id = $1
      ORDER BY created_at DESC`,
    [tenantId],
  );
  return rows;
}
