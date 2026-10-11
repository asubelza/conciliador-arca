# PR-6 Apply Progress — conciliacion-periodica (Phase 3: Cierre de Mes + Reporte + Frontend)

**Branch:** `feature/mvp-carga-comprobantes-pr-3` (same as PR-4/PR-5, not yet split onto its own branch)
**Context:** continues directly from PR-5 (Phase 2: stock histórico + matching de 3 pasos). This doc covers T27–T32, all of PR-6/Phase 3.

## Status: complete (T27–T32, backend + frontend)

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

## Tasks completed (frontend)

| Task | What | Evidence |
|------|------|----------|
| T30 | `PeriodoSelector.tsx` (new): tenant lookup, lists existing períodos, creates a new one — this is what actually fixes the 400 `UploadForm` has been returning since PR-4 (nothing upstream of it ever collected a `periodo_id` until now). `UploadForm.tsx` no longer collects `tenant_id` itself — it now takes `tenantId`/`periodoId` as props from the período already selected upstream, so every upload it submits is pre-scoped to an open período. `app/page.tsx` keeps the selected período in state across multiple uploads (no full page reload needed between them) and offers "Cerrar Conciliación del Mes" (RF-20) from inside `PeriodoReportViewer.tsx`, with a `window.confirm()` guard before calling it | `PeriodoSelector.test.tsx` (4 tests), rewritten `UploadForm.test.tsx` (3 tests), a full Playwright browser run against the real API+worker (see below) |
| T31 | `PeriodoReportViewer.tsx` (new): the 3-section report (Conciliados OK / Discrepancias y Alertas / Pendientes en ARCA), live while `abierto` or frozen once `cerrado` — mirrors `periodo-report.ts`'s `live` flag in its own header ("Vista en vivo" vs. "Snapshot congelado"). `antiguedad_meses` is a dedicated column shown only in Pendientes en ARCA; `con_divergencia` rows carry a visible `divergencia_ars` amount, distinguishing an accepted divergence from an exact match (RF-23) | `PeriodoReportViewer.test.tsx` (3 tests) + the Playwright run |
| T32 | `TenantConfigPanel.tsx` (new): a minimal GET/PUT `tolerancia_redondeo_ars` editor, reachable from `PeriodoSelector` via a "Configurar tolerancia" toggle once a tenant is looked up | `TenantConfigPanel.test.tsx` (3 tests) |

## Bugs caught by a real browser run (not just component tests)

Component tests (jest + Testing Library, mocked `fetch`) all passed on the first try for every new component — but they test each component in isolation, so they couldn't catch two real bugs in how `app/page.tsx` wired them *together*. Both were only found by actually running the full stack — real Postgres, real Redis, the real NestJS API, the real BullMQ worker, and the real Next.js dev server — and driving a real Chromium browser through it end to end with Playwright (tenant lookup → create período → upload two real CSV files → wait for the worker to actually process them → read the live período report → close the período with the confirm dialog → reload and confirm the closed período shows its frozen report with no upload form). That run is what this phase's task list calls "cargas múltiples..." and "reporte..." actually working, not just typechecking:

1. **`StatusPoller`'s `onCompleted` fired and the parent swapped straight back to the upload form in the same render** — so the user never actually saw *any* confirmation an upload had finished; the whole "processing" state flashed and vanished. Fixed by adding an explicit `'completed'` step between `'processing'` and being able to upload again, with its own "Carga procesada." message and a "Subir otro archivo" button the user has to click.
2. **The per-job `ReportViewer` was mounted immediately when `'processing'` started**, so it fetched `GET /api/reconciliations/:jobId/report` while the job was still running and got a permanent 409 (that endpoint has no retry — it's meant to be requested once a job is known to be done). Fixed by moving `ReportViewer` out of the `'processing'` step and into the new `'completed'` step, where the job is guaranteed to have actually finished.

Both are documented here rather than left implicit, because they're exactly the kind of bug that "the code compiles and the mocked tests pass" doesn't catch — the reason this phase's verification included a real end-to-end browser run at all.

## Test Summary (frontend)

- `packages/web`: **20/20 passing** (`npx jest --config jest.web.config.js`) — 3 new PeriodoSelector tests, 3 new TenantConfigPanel tests, 3 new PeriodoReportViewer tests, UploadForm's 4 tests rewritten for its new `tenantId`/`periodoId` props (no more in-form tenant_id field). `npx next build` compiles and type-checks cleanly.
- A full Playwright run (real Postgres 16 + Redis 7 + a live NestJS API + BullMQ worker + Next.js dev server, real Chromium, real multipart file upload) exercised the complete happy path end to end and passed after the two fixes above.

## Deliberately not yet done

- CSV/XLSX for `GET /api/periodos/:id/report` (see design decision #2 above) — JSON only, matching what the frontend actually consumes.
- The pre-existing `app_role` grants gap (flagged again in PR-3/PR-4/PR-5's progress docs) — `periodo_resultados` follows the same pattern as every other table: RLS + a `REVOKE` for defense in depth, but no explicit `GRANT` yet, so it's invisible in practice because every connection in this environment is the superuser.
- No automated end-to-end test captures the Playwright run above — it was a manual verification pass for this phase, not added as a CI-run test (the repo has no Playwright/e2e harness set up yet; adding one is a bigger decision than this phase's scope).
