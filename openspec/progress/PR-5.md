# PR-5 Apply Progress — conciliacion-periodica (Phase 2: stock histórico + matching de 3 pasos)

**Branch:** `feature/mvp-carga-comprobantes-pr-3` (PR-5 not yet split onto its own branch, same as PR-4 — base for the eventual `feature/conciliacion-periodica-pr-5` is PR-4's tip, commit `f8a9f29`)
**Context:** continues directly from PR-4 (Phase 1: períodos + tenant tolerance). This progress doc covers T21–T26, all of PR-5/Phase 2.

## Tasks completed

| Task | What | Evidence |
|------|------|----------|
| T21 | Migration 015: `vouchers_canonical` gains `estado` (`pendiente`/`conciliado`, default `pendiente`), `periodo_alta_id`, `periodo_cierre_id`, plus `idx_vouchers_tenant_key_unique` — the real composite-key uniqueness enforcement `(tenant_id, file_source, cuit_emisor, tipo_cbte, punto_venta, numero)` (RF-15/RF-16) | Applied clean against real Postgres 16; `schema.test.ts` structural coverage |
| T22 | `vouchers-canonical-writer.ts`: real upsert of normalized `CanonicalVoucher`s into `vouchers_canonical`, wired into `reconciliation.worker.ts` — every upload now also populates the persistent stock, not just `reconciliation_results` | `vouchers-canonical-writer.test.ts` (8 tests) + 2 new `reconciliation.worker.test.ts` cases, all against real Postgres |
| T23 | `periodo-matching-engine.ts`'s `matchPeriodo()`: the 3-step match (exclude conciliado by construction → match corriente → match histórico) | `periodo-matching-engine.test.ts` (10 tests, one per RF-16/17/18/19 spec scenario) |
| T24 | Amount-tolerance comparison, `conciliado_ok` vs `con_divergencia` (RF-18) | Same test file — within/exceeding tolerance, two tenants with different tolerances on the same $2.00 gap |
| T25 | `posible_duplicado_en_sistema` detection (RF-17) — a single batched query against ever-conciliado ARCA rows, not N+1 | Same test file |
| T26 | `antiguedad_meses` for `pendiente_en_arca` rows (RF-19) — calendar-month difference via `periodos.mes` | Same test file — 3-month-old pendiente reports `antiguedad_meses = 3` |

## Design decisions made to resolve spec ambiguity (flagged for the client to correct if wrong)

The spec (`matching-periodico.spec.md`, `stock-historico-comprobantes.spec.md`) doesn't fully pin down two things RF-15's general upsert requirement needs to work for *both* file_source sides. Both are documented in `vouchers-canonical-writer.ts`'s module doc, not just here:

1. **`periodo_alta_id` behaves differently for ARCA vs. contabilidad.** ARCA rows keep whatever período first inserted them, forever (needed for RF-19's antiguedad_meses — a pendiente ARCA voucher rolls forward across períodos without being re-uploaded). Contabilidad (Sistema) rows get `periodo_alta_id` refreshed to the current período on every re-upsert (needed so `periodo-matching-engine.ts`'s "sistema_rows loaded in período P" query — `WHERE file_source = 'contabilidad' AND periodo_alta_id = :periodoId` — actually reflects the current period's own upload rather than whichever period first happened to see that composite key).
2. **RF-16's own first scenario describes an impossible fixture** given RF-15's real unique index: "an unrelated pendiente voucher with the SAME composite key" existing simultaneously as a historical row and a current-período row can't happen — `idx_vouchers_tenant_key_unique` allows exactly one row per composite key regardless of período. `periodo-matching-engine.test.ts`'s equivalent test (and a comment on it) explains this and tests the real guarantee instead: a corriente match is found by its own key, and a genuinely different historical pendiente row is left untouched.

Both are judgment calls made to keep the system correct and testable, not confirmed with the client. If either reads wrong once real usage patterns are seen (e.g. a company genuinely does re-upload a prior month's ARCA export), it's a small, contained change — `vouchers-canonical-writer.ts`'s upsert SQL is the only place the `periodo_alta_id` behavior lives.

## Deliberately not yet done (Phase 3 scope, not a gap)

- `matchPeriodo()` is not wired to any HTTP endpoint yet — nothing calls it in response to a real request. That's T27 (`POST /api/periodos/:id/cerrar`, which will call it and persist the final `conciliado`/`pendiente` states) and T29 (`GET /api/periodos/:id/report`, which will call it read-only for the 3-section report).
- `periodo_cierre_id` (added by this migration) is not set anywhere yet — that's also T27.
- `reconciliation_results.periodo_id` still doesn't exist (same deferral noted in PR-4.md) — the per-job report/status endpoints are unchanged and still work exactly as before; `matchPeriodo()`'s results aren't persisted anywhere, they're computed fresh each call (matches architecture.md's "recalcula sobre el estado actual del período, no acumula incrementalmente").

## Test Summary

- `packages/api`: **286/286 passing** (`npx jest --config jest.config.js` from repo root, real Postgres 16 + Redis 7 — 23 new tests since PR-4's 263: 8 for the upsert writer, 10 for the matching engine, 2 for the worker wiring, 2 for the `normalizeStagedRows` refactor, 1 new schema.test.ts structural check). `nest build` and root `tsc --noEmit` both clean.
- No regressions: every PR-2/PR-3/PR-4 test (including the full RF-01–RF-13 suite) still passes unchanged.

## Status

**PR-5 / Phase 2 (T21–T26) complete.** Next up per `openspec/tasks/conciliacion-periodica.yaml`: Phase 3 (PR-6) — `POST /api/periodos/:id/cerrar` (T27, persists final states + rollover), tolerance snapshot at close (T28), `GET /api/periodos/:id/report` 3-section report (T29), and the frontend catch-up (T30–T32: período selection, cierre button, tolerance config, report viewer) — which is also what fixes the upload-form breakage flagged in PR-4.md.
