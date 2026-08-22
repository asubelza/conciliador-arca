# PR-6 Apply Progress — conciliacion-periodica (Phase 3: Cierre de Mes + Reporte + Frontend)

**Branch:** `feature/mvp-carga-comprobantes-pr-3` (same as PR-4/PR-5, not yet split onto its own branch)
**Context:** continues directly from PR-5 (Phase 2: stock histórico + matching de 3 pasos). This doc covers T27–T32, all of PR-6/Phase 3.

## Status: backend (T27–T29) complete; frontend (T30–T32) in progress

## Tasks completed (backend)

| Task | What | Evidence |
|------|------|----------|
| T27 | `POST /api/periodos/:id/cerrar`: `periodo-cierre.ts`'s `cerrarPeriodo()` — runs `matchPeriodo()` inside the close transaction (via a `PoolClient`, not the shared `Pool` — see periodo-matching-engine.ts's new `Queryable` type), conciliates every matched voucher's `vouchers_canonical` row(s), leaves unmatched ARCA rows untouched (rollover is "do nothing", not a copy), and rejects a double close with 409 (RF-20) | `periodo-cierre.test.ts` (7 tests) + integration tests in `periodos.controller.test.ts` |
| T28 | Migration 016: `periodo_resultados` — the frozen 3-section snapshot, one row per match result, written once inside the same close transaction; append-only for `app_role` (same `REVOKE UPDATE, DELETE` guarantee as `audit_trail`). `periodos.tolerancia_ars` is snapshotted from the tenant's *current* `tolerancia_redondeo_ars` at close time — a later tenant tolerance change never rewrites a closed período's historical classification (RF-21) | `schema.test.ts` structural coverage + `periodo-cierre.test.ts`'s RF-21 scenario + an explicit `SET ROLE app_role` permission-denied test |
| T29 | `GET /api/periodos/:id/report`: `periodo-report.ts`'s `getPeriodoReport()` — live `matchPeriodo()` recompute while `abierto`, reads the frozen `periodo_resultados` snapshot once `cerrado`. Section assignment differs by state per RF-23: an open período's `con_divergencia` rows sit in "Discrepancias y Alertas" (still under review); once closed, RF-20 has already conciliated them, so they move into "Conciliados OK" but keep a `divergencia_ars` field so the UI can still flag them | `periodo-report.test.ts` (5 tests, one per RF-22/RF-23 scenario) + integration coverage |

## Design decisions made (flagged for the client to confirm)

1. **`periodo_resultados` is a new table, not a reuse of `reconciliation_results`.** The latter is job-scoped (`job_id`) with the job-level 5-category taxonomy (matched/unmatched-arca/unmatched-contabilidad/duplicates/errors, RF-08/RF-09) — unrelated to a período's 5-category matching taxonomy. Mixing them would force one CHECK constraint and one report-generator to branch on scope. The per-job report/export endpoints (T11/T13) are completely unchanged by this phase.
2. **`format=json` only for `GET /api/periodos/:id/report`.** RF-22's own spec scenarios only exercise `format=json`, and the spec's "Open Questions" section explicitly leaves CSV/XLSX for this endpoint unconfirmed with the client ("this spec assumes CSV/XLSX/JSON stay as today... Confirm no new format is needed"). Rather than guess a layout the client hasn't seen, T29 ships JSON only; the existing per-job CSV/XLSX export (T11/T13) is untouched and still works exactly as before. Add CSV/XLSX for this endpoint once the client confirms the format is wanted.
3. **`matchPeriodo()` now takes any object with a `.query()` method (`Pool` or `PoolClient`), not just `Pool`.** RF-20 requires the close to run "within a single transaction" — that means the match itself has to run against the transaction's own `PoolClient`, not the shared pool, so a period isn't matched against one view of the data and written against another. This is a small, backward-compatible type widening (`periodo-matching-engine.ts`'s new `Queryable = Pick<Pool, 'query'>`); the report endpoint (an open período's live view) still calls it with the plain `Pool`.

## Bug caught and fixed during real-Postgres testing

`cerrarPeriodo()` originally passed the free-text `cerrado_por` field straight into `audit_trail.user_id` — but that column is `UUID` (006_init_audit_trail.sql), and `cerrado_por` is an email/name label, not a UUID (there's still no auth/user system in this codebase). The first real test run against Postgres failed with `invalid input syntax for type uuid`. Fixed by moving `cerrado_por` into the audit event's `details` JSON instead of `user_id` — caught by the real database rejecting the value, not by inspection.

## Test Summary (backend)

- `packages/api`: **309/309 passing** (`npx jest --config jest.config.js` from repo root, real Postgres 16 + Redis 7 — 23 new tests since PR-5's 286: 7 for `cerrarPeriodo`, 5 for `getPeriodoReport`, 5 new controller integration tests, 3 new `schema.test.ts` structural checks, plus the `Queryable` type-widening change verified as a no-op against all of PR-5's existing `periodo-matching-engine.test.ts` cases). `nest build` and root `tsc --noEmit` both clean.
- No regressions: every PR-2/PR-3/PR-4/PR-5 test still passes unchanged.

## Deliberately not yet done

- Frontend (T30–T32): período selection/creation in the upload form (this is what fixes the 400 the upload form has been returning since PR-4), the "Cerrar Conciliación del Mes" button, the new 3-section report viewer, and the tenant tolerance config UI. In progress — see the rest of this doc once T30–T32 land, or check `openspec/tasks/conciliacion-periodica.yaml` for current status.
- CSV/XLSX for `GET /api/periodos/:id/report` (see design decision #2 above).
- The pre-existing `app_role` grants gap (flagged again in PR-3/PR-4/PR-5's progress docs) — `periodo_resultados` follows the same pattern as every other table: RLS + a `REVOKE` for defense in depth, but no explicit `GRANT` yet, so it's invisible in practice because every connection in this environment is the superuser.
