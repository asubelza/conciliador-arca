# PR-1 Apply Progress — mvp-carga-comprobantes

**Branch:** `feature/mvp-carga-comprobantes-pr-1` (base: `master`)
**Mode:** Strict TDD (red → green → refactor, each task verified by execution)
**Coverage target:** 80% (openspec/config.yaml)
**Delivery:** chained PR slice — `feature-branch-chain` (resolved from `pending` → `feature-branch-chain`; Decision needed = No)

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| T01 | `packages/shared-types/src/index.test.ts` | Unit | N/A (new) | ✅ Written — `Cannot find module './index'` | ✅ 12/12 pass | ✅ catalogue count/validity + label mapping + compile-time type contract | ✅ Clean — pure constants + `isValidAfipTipo` type guard |
| T02 | `packages/api/src/schema.test.ts` | Unit (structural) | N/A (new) | ✅ Written — no migrations/schema existed | ✅ 33/33 pass | ✅ 6 tables, every key column, 3 indexes, 4 RLS policies, REVOKE, Prisma models | ✅ Clean — migrations ordered; tenant_id leading every index |
| T03 | `packages/api/src/seed.test.ts` | Unit + execution (sqlite3 in-memory) | N/A (new) | ✅ Written — `Parameter 'sql' implicitly has an 'any'` (seed missing) | ✅ 4/4 pass | ✅ pure rows + SQL shape + real INSERT execution against sqlite | ✅ Clean — DB-agnostic pure functions derived from shared-types |

## Test Summary

- **Total tests written (PR-1):** 49
- **Total tests passing:** 49 (100%)
- **Layers used:** Unit (49) — structural DDL assertions (T02) + pure-function + sqlite3 execution (T03)
- **Pure functions created:** `isValidAfipTipo`, `generateSeedRows`, `generateSeedSql`, `runSeed`
- **Coverage (jest --coverage):**
  | File | Stmts | Branch | Funcs | Lines |
  |------|-------|--------|-------|-------| 
  | `shared-types/src/index.ts` | 100% | 100% | 100% | 100% |
  | `api/src/seed.ts` | 100% | 50% | 100% | 100% |
  | `api/src/{main,app.module}.ts` | 0% | — | — | 0% (scaffold, untested) |

  `seed.ts` 50% branch = the `activo ? 'TRUE' : 'FALSE'` ternary's FALSE limb, which is degenerate (the seed always emits `activo=true`). Lines 100%. The bootstrap `main.ts`/`app.module.ts` are PR-1 scaffolding with no unit surface; integration smoke is deferred.

## Completed Tasks (T01–T03)

- [x] T01 — `packages/shared-types` with `AFIP_TIPOS_CADENCIAL` (15), `ComprobanteTipo`, `isValidAfipTipo`, `Classification`, `CanonicalVoucher`, `VoucherRow`, `VoucherStagingRow`, `ReconciliationResult`, `TenantId`.
- [x] T02 — Prisma `schema.prisma` + 7 migration files (tenants, afip_tipo_map, vouchers_staging, vouchers_canonical, reconciliation_results, audit_trail, RLS) with tenant_id-leading indexes and `tenant_isolation` RLS backstop.
- [x] T03 — `prisma/seed.ts` seeding the 15 AFIP tipos (derived from shared-types) with an execution test against in-memory SQLite.

## Remaining in Phase 1 / PR-2 / PR-3

- [ ] T04 — POST `/api/reconciliations` validation (2 files, size, extension whitelist)
- [ ] T05 — Streaming multipart → COPY staging + BullMQ enqueue
- [ ] T06 — GET status poll endpoint
- [ ] T07 — afip_tipo_map lookup + column-variant adapters
- [ ] T08 — ComprobanteCanonical normalizer
- [ ] T09–T13 — matching engine, classification, reporting, audit, frontend

## Deviations from Design (and why)

1. **No PostgreSQL in environment.** Migrations are PostgreSQL-faithful (uuid/jsonb/gen_random_uuid/RLS per `architecture.md`) but cannot be *executed* here (SQLite rejects `CREATE POLICY`/`ENABLE RLS`/`REVOKE`; PG types rejected by sqlite3). T02 is therefore verified by **structural DDL assertions** on the migration files (tables + columns + indexes + policies + REVOKE) rather than live execution. Execution smoke is deferred to the verify phase against managed PostgreSQL.
2. **Tipo representation split.** The spec `ComprobanteCanonical` DTO uses `tipo_cbte: number` (canonical AFIP int); T02 stores `tipo CHAR(3)` (the zero-padded code, matching `afip_tipo_map.tipo` and the shared `AfipTipo`). The normalization layer (PR-2 T08) bridges the integer canonical code and the stored code.
3. **T02 schema = PR-1 slice.** `vouchers_canonical` carries the PR-1 columns (fecha, tipo, cuit_emisor, punto_venta, numero, importe_total, iva) plus tenant_id; richer design columns (`cae`, `moneda`, `cotizacion`, `file_source`, `source_row`, `signs_debit`) are deferred to PR-2/PR-3 normalization.
4. **T03 seed = 15 rows.** The task's seed bullet list enumerated 13 tipos; the canonical `AFIP_TIPOS_CADENCIAL` list (T01) is 15, and the test requires "all 15 rows inserted". Seed is derived from the shared-types constant, so it seeds **all 15** (adding `022 NOTA_DE_RETENCION_ENTIDADES`, `023 NOTA_DE_RETENCION_PERSONAS`), satisfying the count.

## Issues / Risks Found During Implement

1. **Postgres unavailable** — RLS cannot be execution-tested in this env (see Deviation #1).
2. **Tipo DTO ↔ DB code mismatch** — must be kept consistent in the normalization layer; a future dev could misalign `tipo_cbte` (int) and `tipo` (char) silently.
3. **Bootstrap coverage** — `main.ts`/`app.module.ts` are 0% covered (scaffolding only).
4. **sqlite3 type strictness** — `db.all` returns `unknown[]` under the bundled types, requiring explicit casts in tests.
5. **RESOLVED (post-hoc review, 2026-08-18):** migrations assumed `pgcrypto` and `app_role` already existed on the target database. Neither is created anywhere, so a fresh PostgreSQL instance (e.g. a new Railway/Render DB) would fail on migration 001 (`gen_random_uuid()` requires pgcrypto) and again on 007 (`REVOKE ... FROM app_role` requires the role to exist). Fixed by adding `000_bootstrap_extensions_and_roles.sql`, which runs before 001 and provisions both. `schema.test.ts` gained a `bootstrap prerequisites (000)` block asserting the migration exists, sorts first, and that pgcrypto/app_role are declared *before* their first use (comment-stripped ordering check, so the assertion isn't fooled by prose mentioning the keywords). Suite is now 53/53 green, `tsc --noEmit` clean.

## Workload / PR Boundary

- **Mode:** chained PR slice (`feature-branch-chain`)
- **Current work unit:** PR-1 Foundation (T01–T03)
- **Boundary:** `master` (scaffolding commit) → `feature/mvp-carga-comprobantes-pr-1`
- **Commits:**
  1. `feat(shared): add AFIP tipo map enum and canonical voucher types` (T01)
  2. `feat(api): add Prisma schema + migrations with RLS for multi-tenant` (T02)
  3. `chore(api): seed afip_tipo_map with 15 AFIP comprobante tipos` (T03)
- **Estimated changed lines (PR-1 slice):** ~850 lines (SQL migrations + Prisma + types + tests + scaffold)

## Status

T01, T02, T03 — 49/49 tests passing, `tsc --noEmit` clean. **PR-1 complete. Awaiting orchestrator to review + open PR-1. PR-2 apply pending chain-strategy confirmation (already set: `feature-branch-chain`).**
