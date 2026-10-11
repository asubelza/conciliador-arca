# app_role Least-Privilege Grants — Gap Closure

**Branch:** `feature/mvp-carga-comprobantes-pr-3` (same branch as PR-4/PR-5/PR-6 — this is a security hardening fix, not a new functional task, so it wasn't given its own PR-N slot in `openspec/tasks/conciliacion-periodica.yaml`).

**Context:** flagged first during PR-3's review as a module comment in `011_grant_app_role_audit_feedback.sql`: `app_role` (created `NOLOGIN` in `000_bootstrap_extensions_and_roles.sql`) had zero GRANTs on any table until that migration granted `audit_trail`/`feedback_loop`. Every other table (`tenants`, `vouchers_staging`, `vouchers_canonical`, `reconciliation_results`, `periodos`, `periodo_resultados`) remained ungranted through PR-4/PR-5/PR-6 — invisible in practice because every migration, test, and dev connection in this environment authenticates as the superuser role `conciliador`, which bypasses all privilege checks entirely. This is a real pre-deploy requirement (the day the app's own `DATABASE_URL` is switched to a role that actually is `app_role`, or is granted membership in it), not a bug anyone had hit yet. The user explicitly chose to close this gap now, via `AskUserQuestion`, over the alternatives (opening GitHub PRs, waiting on client feedback for flagged design decisions).

## What was done

- **Migration `017_grant_app_role_remaining_tables.sql`** — the grant plan was not guessed: every GRANT is scoped to exactly what the running API/worker code does against that table today, verified by reading every `INSERT`/`UPDATE`/`DELETE`/`COPY`/`SELECT ... FOR UPDATE` statement in `packages/api/src` (not assumed from the table's shape).

  | Table | Grants | Why (real statement, not guessed) |
  |---|---|---|
  | `tenants` | `SELECT, UPDATE` | `tenants.controller.ts`'s `GET`/`PUT /api/tenants/:id/config`; `periodo-cierre.ts`/`periodo-report.ts` also `SELECT tolerancia_redondeo_ars`. No `INSERT`: tenant provisioning is an out-of-band admin action, not an app code path. |
  | `vouchers_staging` | `SELECT, INSERT` | `staging-writer.ts`'s `COPY FROM STDIN` (Postgres requires the same `INSERT` privilege for `COPY FROM` as for a literal `INSERT`) + the worker's own read-back in the same transaction. |
  | `vouchers_canonical` | `SELECT, INSERT, UPDATE` | `vouchers-canonical-writer.ts`'s `INSERT ... ON CONFLICT DO UPDATE` (an upsert needs both privileges); `periodo-matching-engine.ts`'s `SELECT`s; `periodo-cierre.ts`'s `UPDATE ... SET estado = 'conciliado', periodo_cierre_id`. |
  | `reconciliation_results` | `SELECT, INSERT` | `results-writer.ts`'s `COPY FROM STDIN` + the per-job report endpoint's `SELECT`. No `UPDATE`/`DELETE`: the app never modifies a result row once written. |
  | `periodos` | `SELECT, INSERT, UPDATE` | `periodos.controller.ts`'s `POST`/`GET`; `periodo-cierre.ts`'s `SELECT ... FOR UPDATE` (a row-lock read, which Postgres requires `UPDATE` privilege for, not just `SELECT`) and its final `UPDATE ... SET estado = 'cerrado', ...`. |
  | `periodo_resultados` | `SELECT, INSERT` | `periodo-cierre.ts`'s `INSERT` (the frozen snapshot) + `periodo-report.ts`'s `SELECT`. `016_init_periodo_resultados.sql` already `REVOKE`s `UPDATE`/`DELETE` (append-only) — same ordering as `audit_trail`'s own 007-then-011 split. |
  | `afip_tipo_map` | **nothing** | Confirmed by reading `afip-tipo-lookup.ts`'s module doc and grepping the codebase: the running app never queries this table at request time at all — the AFIP tipo catalogue is resolved from an in-memory `shared-types` constant. Only `seed.ts` writes to it, out of band. Granting a privilege the app will never use would just widen the attack surface for nothing. |

  No table gets `DELETE`: no app code path deletes production rows (only test cleanup, which always runs over the superuser test connection).

- **`packages/api/src/app-role-grants.test.ts`** (new, 14 tests) — real PostgreSQL, same `SET ROLE app_role` / `SET LOCAL app.tenant_id` technique established in `audit-logger.test.ts` and reused in `periodo-cierre.test.ts`. Proves both halves of least-privilege for every table above: the intended grants actually work (a real `INSERT`/`SELECT`/`UPDATE` as `app_role` succeeds), AND everything not explicitly granted is genuinely denied with `permission denied` — including every `DELETE` everywhere, `UPDATE` on `reconciliation_results`/`vouchers_staging`, and any access at all (even plain `SELECT`) to `afip_tipo_map`.

- **`packages/api/src/schema.test.ts`** — added a `017: app_role least-privilege grants` block: confirms the migration file exists and its six `GRANT` statements are present with the exact expected privilege lists, plus an explicit assertion that `afip_tipo_map` is never granted anything to `app_role`. Mirrors the existing style of the file's other structural checks (this file can't execute real `GRANT`/`REVOKE` — that's what `app-role-grants.test.ts` is for).

## Real Postgres verification

Applied migration 017 to a live PostgreSQL 16 test database (`apply_migrations.js`) — applied cleanly on top of the existing 16 migrations. Full backend suite: **331/331 passing** (`npx jest --config jest.config.js` from repo root — 309 pre-existing + 14 new `app-role-grants.test.ts` + 8 new `schema.test.ts` assertions). `npx tsc --noEmit` and `npx nest build` both clean. No regressions: every PR-1 through PR-6 test still passes unchanged.

## Deliberately not yet done

- `app_role` is still `NOLOGIN` — granting it `LOGIN`/a password, or switching the app's own `DATABASE_URL` to actually connect as (or as a member of) `app_role` instead of the superuser, is an infra/deploy decision, not something a migration should hardcode (per `000_bootstrap_extensions_and_roles.sql`'s own comment). This migration only makes that switch *possible* without breaking anything — it doesn't flip it.
- `feedback_loop` was already granted by 011 and untouched here.
