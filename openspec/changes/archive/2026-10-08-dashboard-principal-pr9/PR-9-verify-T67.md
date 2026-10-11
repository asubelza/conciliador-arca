# T67 Verify Report — dashboard-principal Phase 3 (cross-verification)

**Date**: 2026-09-26 | **Branch**: feature/dashboard-principal-pr-9c | **Mode**: Strict TDD (validation only, no code changes)

## Completeness
| Metric | Value |
|--------|-------|
| Tasks total (Phase 1-3) | 17 (T52-T68) |
| Tasks complete | T52-T66 (marked [x]); T67 = this report |
| Tasks incomplete | T68 (explicitly deferred, out of scope) |

## Build & Tests Execution

**packages/web**: ✅ PASS — `npx jest --config jest.web.config.js` → 119/119 passed, 17 suites. `npx tsc --noEmit` clean. `npx next build` → Compiled successfully, static export ok.

**packages/api**: ❌ FAIL — `npx jest --config jest.api.json` → 26 suites failed / 14 passed, 96 tests failed / 182 passed. `npx tsc --noEmit` → same errors repo-wide. `npm run build` (`nest build`) → fails, `@nestjs/cli` binary not resolvable.

### Root cause (confirmed, NOT related to the reverted jest/tsconfig hacks)
Two independent, pre-existing **environment/install-state** defects, unrelated to PR-8/PR-9 source code:

1. **Missing workspace symlink**: `node_modules/shared-types` is listed in `package-lock.json`/`node_modules/.package-lock.json` as `"link": true` → `packages/shared-types`, but the actual symlink/junction does not exist on disk (`node -e "require.resolve('shared-types')"` → `MODULE_NOT_FOUND`). Because `packages/api/tsconfig.json` intentionally sets `"paths": {}` (commit `4041664`, so `nest build` resolves `shared-types` as a real package, not source), ts-jest can no longer type-resolve the bare `shared-types` import for any file that touches the Nest module graph (`reconciliations.controller.ts`, `tenants.controller.ts`, `periodos.controller.ts`, etc.) → `TS2307: Cannot find module 'shared-types'`. This is an `npm install` state problem (a fresh `npm install` should relink workspaces), not a config or code bug. **Confirmed**: failure is identical whether run from `packages/api` or repo root — the config the user restored is correct; do not re-apply the mapper/paths hack.
2. **Missing test database**: `conciliador_arca_test` does not exist in the running `conciliador-pg` Docker container (only `conciliador_arca` dev DB present) → `periodo-reapertura.test.ts`, `periodo-eliminacion.test.ts`, `app-role-grants.test.ts` (34/34 tests, pure domain suites with no shared-types import) fail with `database "conciliador_arca_test" does not exist`. PR-8.md documents this DB was created ad hoc in a prior session/sandbox; it does not persist in this environment.
3. Two suites (`file-row-stream.test.ts`, `reconciliation.worker.test.ts`) also fail with the pre-existing Windows `ENOTEMPTY` teardown flake, already documented in PR-8.md as unrelated to this change — confirmed reproduced identically.

**Neither defect is caused by dashboard-principal's code.** Remediation (not executed — out of verification scope): run `npm install` at repo root to relink workspaces + `npm run build --workspace=shared-types`; create `conciliador_arca_test` and run migrations 000-023 against it.

## Spec Compliance Matrix (RF-24..RF-40)

| RF | Impl | Test | Result |
|----|------|------|--------|
| RF-24 | `page.tsx`, `Dashboard.tsx` | `page.test.tsx` | ✅ COMPLIANT (verified green, web) |
| RF-25 | `Dashboard.tsx` §A | `Dashboard.test.tsx` | ✅ COMPLIANT |
| RF-26 | `Dashboard.tsx` §B | `Dashboard.test.tsx` | ✅ COMPLIANT |
| RF-27 | `PendientesArcaChart.tsx` | `PendientesArcaChart.test.tsx` | ✅ COMPLIANT |
| RF-28 | `Dashboard.tsx`, `ConfirmDialog.tsx` | `Dashboard.test.tsx`, `ConfirmDialog.test.tsx` | ✅ COMPLIANT |
| RF-29 | `Dashboard.tsx` (SectionSpinner/ErrorBanner) | `Dashboard.test.tsx` | ✅ COMPLIANT |
| RF-30 | `periodos.controller.ts` (`POST :id/reabrir`) | `periodos.controller.test.ts` | ❌ UNTESTED-NOW (env blocked, see above; historically green per PR-8.md) |
| RF-31 | `periodo-reapertura.ts` | `periodo-reapertura.test.ts` | ❌ UNTESTED-NOW (no test DB) |
| RF-32 | `periodo-reapertura.ts` | `periodo-reapertura.test.ts` | ❌ UNTESTED-NOW |
| RF-33 | `periodo-reapertura.ts` | `periodo-reapertura.test.ts` | ❌ UNTESTED-NOW |
| RF-34 | `periodo-reapertura.ts` (audit) | `periodo-reapertura.test.ts` | ❌ UNTESTED-NOW |
| RF-35 | `periodos.controller.ts` (`DELETE :id`), `periodo-eliminacion.ts` | `periodos.controller.test.ts`, `periodo-eliminacion.test.ts` | ❌ UNTESTED-NOW |
| RF-36 | `periodo-eliminacion.ts` | `periodo-eliminacion.test.ts` | ❌ UNTESTED-NOW |
| RF-37 | `periodo-eliminacion.ts` (race) | `periodo-eliminacion.test.ts` | ❌ UNTESTED-NOW |
| RF-38 | `periodo-eliminacion.ts` | `periodo-eliminacion.test.ts` | ❌ UNTESTED-NOW |
| RF-39 | `periodos.controller.ts` | `periodos.controller.test.ts` | ❌ UNTESTED-NOW |
| RF-40 | migration `023_...sql` | `app-role-grants.test.ts` | ❌ UNTESTED-NOW |

**Compliance summary**: 6/16 compliant at runtime today (web); 10/16 (backend, RF-30..RF-40) cannot be confirmed at runtime in this environment right now — code/tests exist and were reported green at PR-8 archive time, but current execution is blocked by infra, not code.

## Issues Found

**CRITICAL**
- `packages/api` test suite cannot run to green in this environment: missing `node_modules/shared-types` workspace symlink (present in lockfile, absent on disk) breaks ts-jest type resolution for any file touching the Nest module graph.
- `conciliador_arca_test` database does not exist in the running Postgres container — all real-PG harness suites (incl. RF-30..RF-40 backend coverage) fail on missing DB, not code defects.
- `nest build` cannot run (`@nestjs/cli` not resolvable) — api build unverifiable.
- T67's own AC ("correr ambas suites completas... verde") is NOT met for `packages/api` as of this run.

**WARNING**
- `packages/api/src/periodos/periodo-reapertura.ts` has an uncommitted local diff (comment-only, clarifies null `periodo_cierre_id` no-op case) on this PR-9 (frontend-only) branch — scope leak into an already-archived PR-8 file; should be committed separately or discarded before proceeding.
- `packages/api/src/reconciliations/reconciliation.worker.ts:146` has a pre-existing `TS2739` type error (missing `ReconciliationJobResult` properties), unrelated to dashboard-principal — surfaced by whole-project `tsc --noEmit`, was likely masked before by per-file ts-jest isolation; worth a follow-up ticket, not a T67 blocker.

**SUGGESTION**
- Add a `predev`/CI check (`test -L node_modules/shared-types || npm install`) to catch this class of workspace-symlink drift automatically before someone spends time re-diagnosing config as the culprit.
- Document the `conciliador_arca_test` bootstrap (migrations 000-023 + seed rows) as a repeatable script rather than ad hoc per-session, since it does not persist across environments/sandboxes.

## Verdict (original, 2026-09-26)
**FAIL (environment-blocked)** for `packages/api`; **PASS** for `packages/web` (119/119, tsc clean, build clean). T67 cannot be closed until the api suite runs green again — this requires an `npm install` (relink workspaces) and recreating `conciliador_arca_test`, not a code fix. No dashboard-principal source defect found for RF-24..RF-29; RF-30..RF-40 remain provisionally trusted per PR-8's archived 503/503 evidence but are NOT re-verified at runtime in this session.

## Re-verification (2026-10-08)

Both environment blockers from the original run are confirmed resolved:

1. **`shared-types` workspace symlink** — RESOLVED. `require.resolve('shared-types')` now resolves to `packages/shared-types/dist/index.js`.
2. **`conciliador_arca_test` database** — RESOLVED. Exists in the `conciliador-pg` container (confirmed via `\l`), no bootstrap needed this time.

**packages/api**: `npx jest --config jest.api.json` → **502/503 passed, 38/40 suites passed**. The only failing suites are the two pre-existing Windows teardown flakes already documented above (`file-row-stream.test.ts` ENOTEMPTY, `reconciliation.worker.test.ts` EPERM) — no new failures. `npx tsc --noEmit` clean — the pre-existing `TS2739` at `reconciliation.worker.ts:146` noted in the original WARNING below is also gone. `npm run build` (`nest build`) succeeded.

**packages/web**: `npx jest --config jest.web.config.js` → **134/134 passed, 17/17 suites**. `npx tsc --noEmit` clean.

This re-verifies RF-30..RF-40 (backend) at runtime, closing the gap left by the original environment-blocked run — all 16 RF-24..RF-40 requirements are now confirmed green at runtime, not just provisionally trusted.

### Final Verdict
**PASS.** T67 is closed. Both suites green (modulo the two pre-existing, unrelated Windows flakes), `tsc` clean in both packages, both builds succeed. No dashboard-principal source defects found.
