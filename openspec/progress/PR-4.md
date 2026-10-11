# PR-4 Apply Progress — conciliacion-periodica (Phase 1: schema fix + períodos)

**Branch:** `feature/mvp-carga-comprobantes-pr-3` (PR-4 not yet split onto its own branch — see openspec/tasks/conciliacion-periodica.yaml's chain plan; base for the eventual `feature/conciliacion-periodica-pr-4` is this branch's tip)
**Context:** client-approved scope expansion (functional spec pasted 2026-08-22) — period-based reconciliation with persistent ARCA voucher stock. Proposal + architecture (`fa6632a`) and specs + task breakdown (`39c5c4a`) were reviewed and approved by the user ("Perfecto me parece bien podemos avanzar") before any implementation started. This progress doc covers T14–T20, all of PR-4/Phase 1.

## Tasks completed

| Task | What | Evidence |
|------|------|----------|
| T14 | Migration 012: replaced the disconnected zero-padded CHAR(3) `afip_tipo_map`/`vouchers_canonical.tipo` scheme with the real AFIP integer codes `afip-tipo-lookup.ts` already produces (RF-14) | Applied clean against real Postgres 16; `shared-types`' `AFIP_TIPOS_CADENCIAL` is now the single source of truth `afip-tipo-lookup.ts` imports instead of duplicating |
| T15 | Rewrote `seed.ts`/`seed-runner.ts` to seed the real integer codes | `seed.test.ts`'s idempotency test now correctly asserts a PK-conflict failure on re-run (the old SQLite fixture had been silently masking this) |
| T16 | Migration 013: `periodos` table (tenant_id, mes, estado, tolerancia_ars snapshot, cerrado_at/cerrado_por) + `UNIQUE(tenant_id, mes)` + RLS policy (RF-12) | `schema.test.ts` structural checks + `periodos.controller.test.ts` proves the UNIQUE constraint rejects a real duplicate insert (409) |
| T17 | Migration 014: `tenants.tolerancia_redondeo_ars NUMERIC(10,2) DEFAULT 0.99` (RF-18) — per-tenant, per the user's explicit choice via AskUserQuestion during proposal review | `tenants.controller.test.ts` |
| T18 | `POST/GET /api/periodos`, `GET /api/periodos/:id` (RF-12) | `periodos.controller.test.ts` (12 tests) against real Postgres — create/list/detail, duplicate-month 409, tenant isolation, `YYYY-MM` normalization to month-start |
| T19 | `POST /api/reconciliations` now requires `periodo_id`; rejects upload when the período is `cerrado` or doesn't belong to the tenant (RF-13) | `reconciliations.controller.test.ts`'s new "T19: periodo_id" block (6 tests) + `periodo-upload-guard.test.ts` (4 tests, real Postgres) |
| T20 | `GET/PUT /api/tenants/:id/config` (per-tenant tolerance) | `tenants.controller.test.ts` (7 tests) |

## New modules

- `packages/api/src/periodos/` — `periodos-validation.ts`, `periodos.controller.ts`, `periodos.module.ts`, `periodo-upload-guard.ts` (the DB-backed exists+abierto check the upload endpoint calls)
- `packages/api/src/tenants/` — `tenants-validation.ts`, `tenants.controller.ts`, `tenants.module.ts`
- Both wired into `app.module.ts` alongside the existing `ReconciliationsModule`

## Real gap found and fixed while implementing T18

Postgres rejects `'2026-05'::date` outright ("invalid input syntax for type date") — a plain cast can't parse a year-month-only string, so `date_trunc('month', $1::date)` never got a chance to normalize it. Discovered via a real integration test (`normalizes a YYYY-MM mes to the 1st of the month`) that failed with a 500 before the fix. Fixed by padding `YYYY-MM` to `YYYY-MM-01` in JS before the query; `date_trunc` still handles the day-of-month case (`2026-04-15` → `2026-04-01`).

## Also fixed while here (not new scope, but touched the same files)

`prisma/schema.prisma` had gone stale since T14 landed (still declared the old CHAR(3) `AfipTipoMap.tipo`/`VoucherCanonical.tipo` — schema.prisma is documentation-only, so nothing caught the drift automatically). Brought it back in sync with the real migrations (`AfipTipoMap.codigo`, `VoucherCanonical.tipoCbte`) and added the new `Periodo` model + `Tenant.toleranciaRedondeoArs` while already in this file. `schema.test.ts` gained matching structural assertions (periodos table shape, RLS policy, tenants.tolerancia_redondeo_ars default) so this kind of drift is caught going forward.

## Deliberately deferred (not a gap — see architecture.md's own migration draft numbering)

- `reconciliation_results.periodo_id` (architecture.md's draft migration 016) is **not** added yet. `ReconciliationJobData.periodoId` is threaded through the queue payload (optional field — the worker doesn't use it yet) so Phase 2's T22 upsert work has it available, but nothing persists it to a column until there's an actual consumer. Avoids a migration with no code reading it yet.
- `vouchers_canonical` itself is still not populated by any live pipeline code (unchanged from PR-2/PR-3) — that's T21/T22 (Phase 2).
- `periodos.controller.ts`'s "detalle + resumen de conteos actuales" (architecture.md's draft) only returns the row, not counts — those depend on columns that don't exist until Phase 2.

## ⚠️ Known consequence for the current frontend

**`packages/web`'s `UploadForm.tsx`/`lib/api.ts` do not send `periodo_id`.** Since T19 makes it a required field, uploading through the current web UI will now fail with a 400 (`periodo_id is required and must be a UUID`) until T30 (Phase 3, frontend período selection) lands. This is the deliberate, planned order from the task breakdown you approved (backend-first, frontend catches up in the last PR of the chain — same pattern as PR-2/PR-3), not an accidental regression — but it does mean **uploading through the UI will be broken on this branch until Phase 3 ships.** The API itself works end to end (verified via curl against a real running instance — create período → upload → 202; upload without período → 400; upload against a closed período → 400).

## Test Summary

- `packages/api`: **263/263 passing** (`npx jest --config jest.config.js` from repo root, real Postgres 16 + Redis 7). `nest build` and root `tsc --noEmit` both clean.
- Manual end-to-end smoke test against a live `node dist/main.js` process (not just jest): tenant creation → `POST /api/periodos` → `GET/PUT /api/tenants/:id/config` → upload rejected without `periodo_id` → upload accepted (202) with a valid open `periodo_id` → upload rejected (400) once the período is closed. All confirmed via real `curl` + real Postgres row inspection.

## Status

**PR-4 / Phase 1 (T14–T20) complete.** Next up per `openspec/tasks/conciliacion-periodica.yaml`: Phase 2 (PR-5) — `vouchers_canonical` gains `estado`/`periodo_alta_id`/`periodo_cierre_id` (T21), the real upsert-by-composite-key logic (T22), the 3-step matching engine (T23), tolerance-based `con_divergencia` (T24), `posible_duplicado_en_sistema` detection (T25), and `antiguedad_meses` (T26).
