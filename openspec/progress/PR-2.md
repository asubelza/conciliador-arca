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

## Remaining in PR-2 / PR-3

- [ ] T05 — Streaming multipart → COPY staging + BullMQ enqueue (the `job_id` T04 returns is currently a placeholder `randomUUID()`, not backed by a real job)
- [ ] T06 — GET status poll endpoint
- [ ] T07 — afip_tipo_map lookup + column-variant adapters
- [ ] T08 — ComprobanteCanonical normalizer
- [ ] T09–T13 — matching engine, classification, reporting, audit, frontend

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

Bootstrap fix + T04 — 71/71 tests passing, `tsc --noEmit` clean. **Ready for review.** T05 (streaming ingestion + BullMQ) is next.
