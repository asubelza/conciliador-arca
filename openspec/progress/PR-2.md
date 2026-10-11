# PR-2 Apply Progress — mvp-carga-comprobantes

**Branch:** `feature/mvp-carga-comprobantes-pr-2` (base: `feature/mvp-carga-comprobantes-pr-1`)
**Mode:** Strict TDD (red → green → refactor, each task verified by execution)
**Coverage target:** 80% (openspec/config.yaml)
**Delivery:** chained PR slice — `feature-branch-chain` (same strategy as PR-1)

## TDD Cycle Evidence

| Task | Test File | Layer | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|-----|-------|-------------|----------|
| Fix (pre-T04) | `packages/api/src/schema.test.ts` (bootstrap block) | Unit (structural) | ✅ `role app_role does not exist` / `gen_random_uuid` risk found in PR-1 review, tests written first | ✅ 4/4 new assertions pass after `000_bootstrap_extensions_and_roles.sql` added | ✅ ordering assertions strip SQL comments so prose can't fake a pass | ✅ Clean |
| T04 | `packages/api/src/reconciliations/upload-validation.test.ts` | Unit (pure function) | ✅ Written — `Cannot find module './upload-validation'` | ✅ 13/13 pass | ✅ boundary (exactly 50MB), case-insensitive extensions, precedence (400 > 413 > 415) | ✅ Clean — dependency-free pure function |
| T04 | `packages/api/src/reconciliations/reconciliations.controller.test.ts` | Integration (Supertest + real NestJS app) | ✅ Written before controller/module existed | ✅ 5/5 pass (202, 400×2, 415, 413 with a real 50MB+1KB buffer) | ✅ real HTTP round-trip, not mocked | ✅ Removed a dead custom `MulterExceptionFilter` — see Deviations #2 |

## Test Summary

- **Total tests written (this slice):** 22 (4 bootstrap + 13 upload-validation + 5 controller integration)
- **Total tests passing (full suite):** 71/71 (100%)
- **Coverage (jest --coverage):** `reconciliations/` package at 100% stmts/funcs/lines, 92.3% branch (one defensive branch in `upload-validation.ts`'s FILE_TOO_LARGE path is unreachable via HTTP because multer already rejects oversized files before the handler runs — covered directly by the pure-function unit test instead). Overall repo: 91.3% stmts, comfortably above the 80% threshold.
- `tsc --noEmit` clean.

## Completed Tasks

- [x] Pre-T04 fix — `000_bootstrap_extensions_and_roles.sql` (pgcrypto + `app_role`), found during PR-1 review (see `progress/PR-1.md`, risk #5).
- [x] T04 — `POST /api/reconciliations`: RF-01 (exactly two files, `arca_file` + `contabilidad_file` multipart fields) and RF-02 (50MB limit, `.csv/.xlsx/.xls` whitelist). Returns 202 + `job_id` + `status_url` on success.

## Update — 2026-08-21: T05–T09 completed (real PostgreSQL/Redis, real device sync)

A prior session (2026-08-18) claimed T05–T13 complete, "todo el MVP terminado," 264/264 tests, frontend included, "todo sincronizado a tu máquina." That was false: the work existed only in that session's ephemeral cloud container, never reached GitHub or the user's machine (the device bridge was broken at the time), and was discarded when the session ended. This was discovered on 2026-08-21 by directly checking the user's machine (`git log` on `feature/mvp-carga-comprobantes-pr-2` stopped at T04), `git ls-remote origin` (only `pr-1` and `master` exist upstream), and this file / `openspec/tasks/mvp-carga-comprobantes.yaml` (both still showed T05+ unchecked). See `claude/estado_dev_y_revision_pr1.md` (Claude Project doc) for the full incident note.

T05–T09 below were then rebuilt from scratch in a fresh session, this time with two changes to the process: (1) real PostgreSQL 16 + Redis running in the cloud workspace, so every claim is checked against actual staged rows / actual query results, not structural assertions on migration SQL text; (2) every task's code was synced to the user's machine via the device bridge (`SendUserFile` + `device_commit_files`) and committed there with `git`, with the commit and `git log`/`git show --stat` verified on the device itself, before being marked done — no task is marked complete on the strength of a claim alone.

| Task | Test File(s) | Layer | Evidence |
|------|-------------|-------|----------|
| T05 | `file-row-stream.test.ts`, `staging-writer.test.ts`, `reconciliation.worker.test.ts`, `reconciliations.controller.test.ts` | Unit + real-Postgres integration | Streaming CSV (csv-parse) + streaming XLSX (exceljs `WorkbookReader`) parsers; `COPY FROM STDIN` into `vouchers_staging`; BullMQ job enqueued with the real `job_id`. Worker wraps staging in one transaction (BEGIN/COMMIT/ROLLBACK) — `reconciliation.worker.test.ts` proves a corrupt contabilidad file rolls back the already-staged arca rows too, verified by querying `vouchers_staging` after the throw. |
| T06 | `job-status.test.ts`, controller integration | Unit + integration | `GET :jobId/status` maps BullMQ's 8 states down to `pending\|processing\|completed\|error`; integration test polls a real enqueued job to `completed` and asserts the returned `counts`. |
| T07 | `afip-tipo-lookup.test.ts`, `column-adapters.test.ts` | Unit | Numeric AFIP tipo codes (1/2/3/6/7/8/11/12/13/19/20/21) accepted from any source; per-vendor text aliases for tango/bejerman/xubio/contabilium; Bejerman's combined `"0001-00001234"` punto_venta/numero split. |
| T08 | `comprobante-normalizer.test.ts` | Unit | CUIT digit-strip, Argentine comma-decimal parsing, dd/mm/yyyy + Excel-serial date parsing, NC/ND negative sign per tipo. |
| T09 | `reconciliation-engine.test.ts` | Unit (perf-asserting) | Same-side dedupe (first occurrence kept); `Map` built on the smaller side, larger side probed once each — test asserts exactly 1000 probes for 1000+950 synthetic vouchers and <500ms wall time, not just a passing match count. |

**Migration bug found and fixed in this pass:** `002_init_afip_tipo_map.sql` created `idx_afip_tipo` as a plain (non-unique) index; migration 004's `tipo REFERENCES afip_tipo_map(tipo)` FK cannot be created without a unique constraint/index on the referenced column. This was never caught by any prior session because none of them had real PostgreSQL to run the migrations against — fixed to `CREATE UNIQUE INDEX`.

**Test count at end of T05–T09:** 130/130 passing (`npx jest --config jest.api.json`, run 3x `--runInBand` + 2x parallel to check for flakiness — all green). `tsc --noEmit` clean.

**Commits (branch `feature/mvp-carga-comprobantes-pr-2`, verified present via `git log`/`git show --stat` run directly on the user's machine through the device bridge):**
- `2d2fef1` — T05
- `9e6a0f0` — T06
- `0e974b3` — T07
- `87e7689` — T08
- `1e0cfa3` — T09 (PR-2's final commit; `feature/mvp-carga-comprobantes-pr-3` branches from here — see `progress/PR-3.md` for T10–T13)

## Remaining

None — PR-2 (T04–T09) is complete. See `progress/PR-3.md` for T10–T13.

## Deviations from Design (and why)

1. **tsconfig needed decorator support.** Root `tsconfig.json` had neither `experimentalDecorators` nor `emitDecoratorMetadata` set — PR-1's scaffold never exercised a NestJS decorator (`@Controller`, `@Post`, etc.), so this went unnoticed until T04. Added both; this is a one-time fix, not a per-task cost.
2. **Removed a dead `MulterExceptionFilter`.** The first pass wrote a custom `@Catch(MulterError)` exception filter to translate multer's `LIMIT_FILE_SIZE` rejection into a 413. Debugging why its coverage stayed at 0% after the 413 test passed revealed that `@nestjs/platform-express` already converts multer errors into `HttpException` subclasses (`PayloadTooLargeException`, `BadRequestException`) *before* they reach a route-level filter — so the custom filter was never invoked; Nest's own default handling was already producing the right status codes. Deleted the filter and the now-pointless "unexpected field" test that only exercised Nest's default, not our code. `validateUploadFiles` still owns the two checks Nest/multer can't do for us: the RF-01 400 (both files required) and the RF-02 415 (extension whitelist) — extension isn't something multer's `fileSize` limit or field config can check.
3. **T04 returns a real 202 + job_id, not a 501 stub.** The task description scopes T04 to validation only, but the spec's acceptance criteria bundle the 202 response with it, and T05 needs a stable contract to build on. `job_id` is generated via `randomUUID()` with no backing job — T05 replaces this with the real BullMQ-enqueued id. This is called out explicitly in the controller's doc comment so it isn't mistaken for T05 being done.

## Issues / Risks Found During Implement

1. **`job_id` is not yet persisted or resolvable.** Until T05/T06 land, `GET /api/reconciliations/:jobId/status` doesn't exist, so a client polling the returned `status_url` today gets a 404. Acceptable for this slice (T04 is validation-only) but worth flagging so it isn't merged as if upload were end-to-end.
2. **No `fileFilter` (MIME sniffing) on multer.** RF-02 whitelists by file *extension* only, matching the spec exactly — but a file renamed `.csv` with different actual content would still pass. Not a spec requirement for T04; worth a future hardening pass (e.g. checking magic bytes) if this becomes a real security concern for the accounting-firm audience.
3. **Local dev environment note:** the working copy on the developer's machine (mounted via the Claude Cowork device bridge) leaves stale `.git/index.lock` files after write operations (the mount doesn't support the atomic rename git relies on to clean them up). Every `git add`/`commit` here had to clear a leftover lock first. This is almost certainly what stopped OpenCode/Gentle mid-run originally. Worth checking whether this repo lives on a network/cloud-synced drive locally — if so, moving it to a local disk path would avoid this class of issue going forward.

## Workload / PR Boundary

- **Mode:** chained PR slice (`feature-branch-chain`)
- **Current work unit:** PR-2 slice 1 (bootstrap fix + T04)
- **Boundary:** `feature/mvp-carga-comprobantes-pr-1` → `feature/mvp-carga-comprobantes-pr-2`
- **Commits:**
  1. `fix(api): bootstrap pgcrypto + app_role before migrations depend on them` (on the PR-1 branch, applied before branching PR-2)
  2. `feat(api): add T04 upload validation for POST /api/reconciliations` (T04)

## Status

**PR-2 complete (T04–T09) — 130/130 tests passing, `tsc --noEmit` clean, verified synced + committed on the user's machine.** See `progress/PR-3.md` for T10–T13 (PR-3).
