# PR-8 Apply Progress — dashboard-principal Slice 1 (Período lifecycle: reabrir + eliminar, backend)

**Branch:** `feature/dashboard-principal-pr-8` (split from `feature/dashboard-principal`; chain strategy: feature-branch-chain, PR-8 = backend slice, PR-9 = frontend slice).
**Context:** implements the período lifecycle endpoints added by the `dashboard-principal` proposal — RF-30 (reabrir), RF-35 (eliminar), RF-36–RF-40 guards/privileges — under strict TDD (RED→GREEN per work unit).

## Status: complete (T52–T59, backend)

## Commits

| Commit | Unit | What |
|--------|------|------|
| `53a060e` | T52+T53 | `feat(api): add reabrirPeriodo to undo a cierre in one transaction` |
| `a35fec9` | T54+T55 | `feat(api): add eliminarPeriodo with hybrid zero-reference guard` |
| `25a768b` | T56+T57+T58 | `feat(api): expose POST :id/reabrir and DELETE :id periodos routes` |
| `aa00c25` | T59 | `feat(api): grant app_role DELETE on periodos and periodo_resultados` |

## Tasks completed

| Task | What | Evidence |
|------|------|----------|
| T52 | RED first: new `periodo-reapertura.test.ts` with the real-PG harness from `periodo-cierre.test.ts` — 8 tests covering close→reopen stamp-scope undo (`counts.vouchers_reabiertos`), manual-resolver marks survive, ARCA rollover intact, snapshot delete (`resultados_eliminados`), column resets, close→reopen→re-close equivalence, in-tx `'reopen'` audit row (absent on failure), 409 ALREADY_ABIERTO, 404 | RED confirmed via TS2307 (module missing); suite failed for the right reason |
| T53 | GREEN: new `periodo-reapertura.ts` — single tx, `SELECT … FOR UPDATE`, typed failures `{code:'NOT_FOUND'\|'ALREADY_ABIERTO', status, error}` mirroring `PeriodoCierreFailure`; undo by `periodo_cierre_id` seal only; snapshot DELETE; `tolerancia_ars/cerrado_at/cerrado_por` reset; `logAuditEvent('reopen')` inside the same tx | 8/8 green; `'reopen'` added to `AuditAction` union in `audit-logger.ts` |
| T54 | RED first: new `periodo-eliminacion.test.ts` — 8 tests incl. **both RF-37 race outcomes proven with real concurrent transactions**: worker upload wins → 409 BLOCKED with counts naming c1/c2 and data intact (~300ms behind an uncommitted worker tx); delete wins → worker INSERT hits FK violation and its job tx rolls back completely | RED confirmed (TS2307) |
| T55 | GREEN: new `periodo-eliminacion.ts` — FOR UPDATE lock + 2 COUNTs in one tx (`vouchers_canonical` by `periodo_alta_id OR periodo_cierre_id`, `periodo_resultados` by `periodo_id`); 409 house-shape `{error}` verbatim: ``cannot delete período: ${c1} comprobante(s) and ${c2} frozen resultado row(s) reference it — only an empty período can be deleted``; physical DELETE (no soft-delete) + in-tx `'delete'` audit | 8/8 green; `'delete'` added to `AuditAction` |
| T56 | Additive shared-types contracts `PeriodoReabrirResponse` / `PeriodoDeleteResponse` in `packages/shared-types/src/index.ts` (design §Interfaces) | `npm run build --workspace=shared-types` clean |
| T57 | RED first: 6 integration tests appended to `periodos.controller.test.ts` proving handler order (400 malformed id on both routes), colaborador reopen success body deep-equals `PeriodoReabrirResponse`, cliente WITH tenant access → 403 (role gate fires before tenant check matters), admin delete empty → `200 {deleted:true, periodo_id}` + subsequent GET 404, colaborador AND cliente → 403 with real access rows, 404 unknown id on both | Exactly 6 fail pre-wiring (404s); 51 pre-existing pass |
| T58 | GREEN: both routes wired in `periodos.controller.ts` mirroring `cerrar`'s exact handler order: `validatePeriodoIdParam` → `assertRole(['admin','colaborador'])` / `assertRole(['admin'])` → `resolvePeriodoTenantId`+`assertTenantAccess` → domain call; typed failures mapped via `HttpException({error}, status)` | 57/57 file green |
| T59 | Migration `023_grant_app_role_delete_periodos.sql`: `GRANT DELETE ON periodos TO app_role; GRANT DELETE ON periodo_resultados TO app_role;` each commented with the exact application statement that needs it. Only the two corresponding denials flipped in `app-role-grants.test.ts` — UPDATE on `periodo_resultados` stays revoked (reopen deletes whole rows, never edits them), every other table's denial asserted unchanged | RED confirmed (2 permission-denied fails) → applied 023 locally → 18/18 green |

## Notable engineering decisions

- **Test isolation for exact-count assertions:** `matchPeriodo` pools a tenant's whole historic voucher stock, and the controller test file shares one tenant across ~50 tests without intra-run cleanup. The new describe block therefore uses its own dedicated tenant (same pattern as the existing list tests) so reopen counts are deterministic.
- **Grant test realism:** the "app_role can DELETE periodos" check runs against a fresh reference-free período — the same precondition `eliminarPeriodo()`'s zero-reference guard establishes — rather than the shared fixture row (which rightly trips `vouchers_canonical`'s FK instead).
- **Append-only posture preserved:** migration 023 grants exactly two DELETEs and nothing else; `016`'s UPDATE-revoke on `periodo_resultados` is explicitly re-proven still in force.

## Test Summary

- `packages/api`: **503/503 tests passing** (`npx jest --config jest.api.json`, real Postgres 16 + Redis 7). `npx tsc --noEmit` clean; shared-types build clean.
- 2 suites (`file-row-stream`, `reconciliation.worker`) report Windows-only temp-dir teardown errors (`ENOTEMPTY`/`EPERM` rmdir of `%TEMP%` fixture dirs). **Verified pre-existing**: reproduced identically at base commit `c4ebd90` via a clean worktree, with zero relation to this change (all their tests pass; only afterAll cleanup races).

## Environment notes

- Test DB `conciliador_arca_test` was created this session (did not exist): migrations 000–022 applied + recorded in `schema_migrations`, plus the 12 missing `afip_tipo_map` seed rows so the catalogue matches the main DB. Migration 023 was applied to the test DB only — the main DB stays owned by the deploy pipeline.

## Known follow-ups

- Frontend slice (PR-9): fetchers `reabrirPeriodo()`/`eliminarPeriodo()` consuming T56 types, UI wiring (T60–T62) — out of this branch's scope by design.
- The two pre-existing Windows teardown flakes above could be fixed upstream (retry-tolerant rmSync in their afterAll) but belong to reconciliation test infra, not this feature.

## Archive Phase Complete (2026-08-23)

- Backend slice PR-8 fully archived
- Delta specs synced to main specs (`periodos.spec.md`, `cierre-de-mes.spec.md`)
- Archive report persisted to Engram topic `sdd/dashboard-principal/archive-report`
- Change folder moved to `openspec/changes/archive/2026-08-23-dashboard-principal/`
- 5 commits archived (T52–T59 complete)
- 503/503 tests passing in `packages/api`
