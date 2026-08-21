# PR-3 Apply Progress — mvp-carga-comprobantes

**Branch:** `feature/mvp-carga-comprobantes-pr-3` (base: `feature/mvp-carga-comprobantes-pr-2`, branched from commit `1e0cfa3`, T09's final commit)
**Mode:** Strict TDD (red → green → refactor, each task verified against real PostgreSQL 16 + Redis)
**Coverage target:** 80% (openspec/config.yaml)
**Context:** see `progress/PR-2.md`'s "Update — 2026-08-21" section for the incident this rebuild followed (a prior session's T05–T13 claim was never actually synced anywhere and was discarded). Every task below was verified with real DB queries and a real `git commit`/`git log`/`git show --stat` run directly on the user's machine via the device bridge before being marked done.

## TDD Cycle Evidence

| Task | Test File(s) | Layer | Evidence |
|------|-------------|-------|----------|
| T10 | `classification-engine.test.ts`, worker + controller integration | Unit + real-Postgres integration | 5-category classification (matched/unmatched-arca/unmatched-contabilidad/duplicates/errors); unmatched sections sorted `iva_amount` DESC. Worker reads staged rows back from Postgres within the same transaction that staged them, classifies, and persists to `reconciliation_results` via `COPY FROM STDIN` — integration test queries the table directly to confirm counts per category. |
| T11 | `report-generator.test.ts` (8 tests), controller integration | Unit + integration | `buildDiffReportRows` (excludes `duplicates`, sorts each section by IVA DESC), `toCsv` (2-decimal money fields), `toXlsxBuffer` (4 named sheets: Matched/Unmatched ARCA/Unmatched Contabilidad/Errors — round-tripped through a real `ExcelJS.Workbook().xlsx.load()` in the test, not just asserted on the write side). `GET :jobId/report` added with 404/409/400, `format=csv\|xlsx`. |
| T12 | `audit-logger.test.ts`, `marks-validation.test.ts`, worker + controller integration | Unit + real-Postgres integration | Worker logs `upload`+`match` audit_trail events inside the job's own transaction (rollback takes the log with it — verified by asserting 0 audit rows after a forced rollback). `POST :jobId/marks` persists to new `feedback_loop` table, logs `user_mark`. **Real append-only check, not structural**: `audit-logger.test.ts` adopts `app_role` via `SET ROLE` (a superuser can `SET ROLE` without needing `app_role` to have `LOGIN`) and asserts `UPDATE`/`DELETE` on `audit_trail` fail with `permission denied`, with an `INSERT` control case proving the block is specific to `UPDATE`/`DELETE`. This is a materially stronger check than the pre-existing `schema.test.ts`, which only regexes the migration SQL text and never touches a live database. |
| T13 | `UploadForm.test.tsx`, `StatusPoller.test.tsx`, `ReportViewer.test.tsx` (11 tests, React Testing Library via `next/jest`) | Component (jsdom) + full `next build` | Upload form (RED: renders `role="alert"` "Both ARCA and contabilidad files are required" when submitted with no files selected, before calling the API); status poller (polls to a terminal state, shows failure detail); report viewer (renders the diff table from `format=json`, CSV/Excel download links, revisado/explicado mark buttons wired to `POST :jobId/marks`). `npx next build` succeeds end-to-end (compiles, type-checks, lints, prerenders). |

## Real gap found and fixed during T12

While writing `audit-logger.test.ts`'s append-only check for real (rather than trusting the structural regex test that already existed), the `app_role` role — the "least-privilege role the application connects as" per `000_bootstrap_extensions_and_roles.sql`'s own comment — turned out to have **no privileges granted on any table at all**. `007_enable_rls.sql`'s `REVOKE UPDATE, DELETE ON audit_trail FROM app_role` only removes privileges the role never had; an `INSERT` as `app_role` failed with `permission denied for table audit_trail` before this was fixed. This had gone unnoticed through every prior session because every DB connection in this project (dev and test) has always used the superuser role `conciliador`, which bypasses privilege checks entirely — the append-only design was never actually exercised by a role that would hit it. Fixed by `011_grant_app_role_audit_feedback.sql` (`GRANT SELECT, INSERT ON audit_trail, feedback_loop TO app_role`; `UPDATE`/`DELETE` stay revoked).

**This same gap almost certainly exists on the other five tables** (`vouchers_staging`, `vouchers_canonical`, `reconciliation_results`, `tenants`, `afip_tipo_map`) — `app_role` has never been granted anything on them either. Out of scope for T12 (which only touches `audit_trail`/`feedback_loop`), but this needs a dedicated pass — a real `app_role`-based DB connection (not the superuser) — before this app can run against `app_role` in any deployed environment rather than a superuser connection.

## Deviations from Design (and why)

1. **`GET :jobId/report` gained `format=json`** (RF-10 only specifies `csv\|xlsx`, on-demand *download*). T13's diff-table viewer needs the same rows as structured data to render, not a file to save. Rather than stand up a second endpoint for the same query + `buildDiffReportRows` call, `format=json` returns `{ rows }` as a normal JSON body — no `Content-Disposition`, since this response is for the page to render, not to download.
2. **`vouchers_canonical` is still not populated** (carried forward from PR-2/T10 — see `009_alter_reconciliation_results_add_job_composite_key.sql`'s comment). Both sides' full canonical voucher JSON lives directly on `reconciliation_results.arca_row`/`contabilidad_row`. Nothing in T10–T13's acceptance criteria requires querying `vouchers_canonical` separately.
3. **`feedback_loop` reads exist (`readFeedbackLoop` in `feedback-writer.ts`) but the matching engine doesn't consult them yet.** RF-11's "Feedback loop persists for future matching" scenario describes the matching engine being *able* to read `feedback_loop` to apply learned exclusions — none of RF-11's 6 acceptance criteria require the engine to actually do so. Implementing that is a `reconciliation-engine.ts` (T09) change with no test coverage requirement here; flagged rather than silently expanded into it.
4. **Root `tsconfig.json` now excludes `packages/web`.** Next.js needs `jsx`/`dom` lib/`bundler` module resolution settings that conflict with the NestJS backend's `commonjs` config. `packages/web` verifies via its own `tsconfig.json` + `next build`'s full type-check, not the root `tsc --noEmit` (which stays the verification gate for `packages/api` + `packages/shared-types`).
5. **Fixed `package.json`'s `test:api` script**, discovered broken while adding the analogous `test:web`: `"test:api": "jest --config jest.api.json"` fails immediately when run from the repo root (`jest.api.json` lives in `packages/api`, and jest resolves `--config` relative to `cwd`, not the workspace). Both are now `npm run test --workspace=<pkg>`, verified working from root.

## Test Summary

- **`packages/api`:** 177/177 passing (`npx jest --config jest.api.json` from `packages/api`, run 3x `--runInBand` + 2x parallel — all green, no flakes). `tsc --noEmit` (root) clean.
- **`packages/web`:** 11/11 passing (`npx jest --config jest.web.config.js`, run 3x — all green). `npx next build` succeeds (compile + typecheck + lint + prerender, 4 routes).

## Commits (branch `feature/mvp-carga-comprobantes-pr-3`, verified via `git log`/`git show --stat` run directly on the user's machine through the device bridge)

- `0fd98d3` — T10: classification (5 categories) + IVA sort + e2e wiring
- `0818948` — T11: `GET :jobId/report` (CSV/XLSX export)
- `29fd351` — T12: audit_trail logging + user marks + feedback_loop (+ the `app_role` grants fix)
- `8c627dc` — T13: Next.js 14 frontend (+ `format=json`, CORS, tsconfig/script fixes)

## Known, documented gaps carried forward (unchanged by this PR)

- IVA is always 0 — no column adapter has a confirmed real IVA source column yet (flagged in `comprobante-normalizer.ts`).
- `.xls` parsing is buffered, not streaming (SheetJS has no streaming reader; documented in `file-row-stream.ts`).
- No auth/session layer — `tenant_id` and `user_id` are trusted client input for the MVP (documented in `upload-validation.ts`, `marks-validation.ts`).
- `app_role` has no grants on `vouchers_staging`/`vouchers_canonical`/`reconciliation_results`/`tenants`/`afip_tipo_map` (see "Real gap found" above) — needs a dedicated pass before any deployment connects as `app_role` instead of a superuser.
- The exposed GitHub token in `_to_delete/tmp-create-pr.ps1` (device machine) is still **not revoked** — flagged repeatedly across sessions now; this is a user action, not something a session can do on their behalf.

## Status

**PR-3 complete (T10–T13) — the full MVP (T01–T13) is now genuinely implemented, tested against real PostgreSQL/Redis, and verified present on the user's machine.** Nothing has been pushed to GitHub (this session has no push credentials, by design) — `git push` for both `pr-2` and `pr-3` branches, and opening PRs, is a user action. `npm install` at the repo root is needed on the user's machine to pull in `packages/web`'s new dependencies (Next.js/React/Tailwind/RTL) before `next dev`/`next build`/`npm run test:web` will work there.
