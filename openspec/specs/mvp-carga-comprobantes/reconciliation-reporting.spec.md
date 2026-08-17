# Reconciliation Reporting Specification

**Change**: mvp-carga-comprobantes
**Link**: openspec/proposal/mvp-carga-comprobantes.md
**Author**: SDD Executor
**Date**: 2026-08-17
**Status**: Draft — Phase A (Spec)

## Purpose

Export reconciliation results as a CSV diff report (matched pairs + both unmatched sides + deltas) and maintain an immutable `audit_log` recording every upload, normalize, match, and export event. Support user marking of vouchers as `revisado` (reviewed) or `explicado` (explained) with a feedback loop persisted for future matching improvements.

## Requirements

### RF-10: CSV diff report export

The system MUST generate a CSV diff report containing: matched pairs (composite key, ARCA amount, contabilidad amount, delta), unmatched ARCA rows, unmatched contabilidad rows, and error rows. The CSV is generated on-demand via `GET /api/reconciliations/:jobId/report`.

#### Scenario: Export matched pair with delta

- GIVEN a matched pair where ARCA amount = $1,500.00 and contabilidad amount = $1,499.00
- WHEN `GET /api/reconciliations/:jobId/report` is called
- THEN the CSV contains a row with `classification=matched`, `arca_importe=1500.00`, `cont_importe=1499.00`, `delta=1.00`
- AND the row is ordered by IVA amount descending

#### Scenario: Export unmatched ARCA rows

- GIVEN 5 ARCA vouchers with no contabilidad counterpart
- WHEN the CSV report is exported
- THEN the CSV contains 5 rows with `classification=unmatched-arca`
- AND each row shows the ARCA voucher's composite key and importe

#### Scenario: Download as Excel (xlsx)

- GIVEN a completed reconciliation with 500 results
- WHEN `GET /api/reconciliations/:jobId/report?format=xlsx` is called
- THEN the response is an Excel spreadsheet with sheets: Matched, Unmatched ARCA, Unmatched Contabilidad, Errors
- AND a download header is set

### RF-11: Immutable audit trail + user marking + feedback loop

The system MUST append-only log every event (upload, staging, normalize, match, export, user_mark) to `audit_log` with `tenant_id`, `user_id`, `action`, `file_name`, `counts`, and `created_at`. Users MUST mark vouchers as `revisado` or `explicado`, and these marks MUST be stored in `feedback_loop` for future matching analysis.

#### Scenario: Audit log records upload event

- GIVEN an accountant uploads two files
- WHEN the upload completes staging
- THEN `audit_log` contains a row with `action = 'upload'`, `tenant_id`, `user_id`, `file_name`, `counts = { rows: 1000 }`
- AND the row cannot be modified or deleted

#### Scenario: User marks voucher as 'explicado'

- GIVEN an unmatched ARCA voucher displayed in the diff report viewer
- WHEN the user clicks "Marcar como explicado" and adds a note
- THEN a row is inserted into `feedback_loop` with `classification = 'explicado'`, `comprobante_key`, `note`, `user_id`, `tenant_id`
- AND `audit_log` records `action = 'user_mark'`

#### Scenario: Feedback loop persists for future matching

- GIVEN 3 vouchers previously marked `explicado` with notes
- WHEN a new reconciliation runs with the same source data
- THEN the matching engine can read `feedback_loop` to apply learned exclusions
- AND `audit_log` records `action = 'feedback_read'`

## Acceptance Criteria

1. `GET /api/reconciliations/:jobId/report` returns CSV with matched + unmatched + error rows
2. CSV rows ordered by IVA amount descending within each section
3. `GET /api/reconciliations/:jobId/report?format=xlsx` returns valid Excel
4. `audit_log` is append-only (no UPDATE/DELETE possible)
5. User marking inserts into `feedback_loop` table
6. All audit_log entries include tenant_id (RLS enforced)

## Data Schema

```typescript
interface DiffReportRow {
  classification: Classification;
  composite_key: string;
  arca_importe: number | null;
  contabilidad_importe: number | null;
  delta: number | null;
  iva_amount: number | null;
  cae: string | null;
  fecha_emision: string | null;
}

enum UserMark {
  Revisado = 'revisado',
  Explicado = 'explicado',
}

interface FeedbackLoopEntry {
  id: string;
  tenant_id: string;
  user_id: string;
  composite_key: string;
  classification: UserMark;
  note: string | null;
  created_at: Date;
}
```

### audit_log table

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| tenant_id | uuid FK | |
| user_id | text | Clerk user id |
| action | text | `'upload' \| 'staging' \| 'normalize' \| 'match' \| 'export' \| 'user_mark' \| 'feedback_read'` |
| file_name | text | nullable |
| counts | jsonb | e.g. `{ "rows": 1000, "matched": 900 }` |
| created_at | timestamptz | `DEFAULT now()` |
| Indexes | | `(tenant_id, created_at DESC)` — RLS policy: `tenant_id = current_setting('app.tenant_id')` |

### feedback_loop table

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| tenant_id | uuid FK | |
| user_id | text | |
| composite_key | text | |
| classification | text | `'revisado' \| 'explicado'` |
| note | text | nullable |
| created_at | timestamptz | |
| Indexes | | `(tenant_id, composite_key, created_at DESC)` |

## TDD Markers

- RED: CSV report endpoint returns rows before it exists
- RED: audit_log entry created on upload — test that no UPDATE/DELETE is possible
- GREEN: User mark persists to `feedback_loop` with correct tenant scope
- GREEN: Feedback loop readable by next reconciliation run
- REFACTOR: Extract `DiffReportGenerator` and `AuditLogger` as separate services

## Non-Goals / Out of Scope

- Real-time WebSocket streaming of report — on-demand download only
- PDF export — CSV/Excel only for MVP
- Automated reconciliation suggestions beyond IVA priority sort
- Cross-tenant feedback sharing — feedback is per-tenant only
