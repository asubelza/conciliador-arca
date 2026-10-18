-- 031_seed_bootstrap_estudio_and_backfill.sql
-- Multi-estudio pivot, step 4 (closes 028-030): turns today's single-firm
-- deployment into "estudio #1" of the new multi-estudio model, with zero
-- behavior change for anyone using the app today.
--
-- Fixed, hardcoded UUID literal (not gen_random_uuid()) for the bootstrap
-- estudio so it is a known, greppable constant across migrations, seed
-- scripts and any future one-off backfill, instead of something that has to
-- be looked up. 'Estudio Contable JY' is a placeholder for the real firm's
-- identity (no better name found in the repo/docker-compose/README) —
-- renameable later via the estudios admin UI once it exists (see the
-- "Migraciones" section's plan).
--
-- migrate-runner.ts already wraps each migration file in its own
-- BEGIN/COMMIT (see migrate-runner.ts) — no explicit transaction statements
-- needed here; all four steps below commit or roll back together as one
-- unit through that existing mechanism.
INSERT INTO estudios (id, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Estudio Contable JY');

-- tenants: every pre-existing row (estudio_id is still NULL for all of them
-- at this point, since 029 only just added the column) belongs to the one
-- firm that has ever used this deployment. Safe to backfill unconditionally.
UPDATE tenants SET estudio_id = '00000000-0000-0000-0000-000000000001'
  WHERE estudio_id IS NULL;

-- users: deliberately backfills EVERY existing user — admin, colaborador AND
-- cliente alike — into the bootstrap estudio, not just staff roles. This is
-- the one really-open point the design explicitly resolved: users.estudio_id
-- stays nullable forever (030's comment) and NULL means "platform staff",
-- but that meaning only applies to accounts created AFTER this migration. A
-- LATER PR (not this one) changes `assertTenantAccess` to require
-- `users.estudio_id = tenants.estudio_id` for admin/colaborador instead of
-- the current "admin/colaborador see every tenant" rule. If any existing
-- user were left with estudio_id = NULL here, that later PR would read them
-- as platform staff with NO implicit tenant access and silently lock them
-- out of data they can access today. Backfilling unconditionally (no WHERE
-- narrowing beyond IS NULL, i.e. literally every row right now) is what
-- keeps "existing users keep working exactly as today" true once that PR
-- lands — it is safe specifically because, at this point in migration
-- history, every user row that exists predates the platform-staff concept
-- entirely; platform-staff accounts are only ever created afterward, with
-- estudio_id left NULL explicitly at creation time, never backfilled into
-- it.
UPDATE users SET estudio_id = '00000000-0000-0000-0000-000000000001'
  WHERE estudio_id IS NULL;

-- tenants.estudio_id is transiently nullable only until this point (see
-- 029's comment) — every row now has a value, so lock it down.
-- users.estudio_id deliberately does NOT get the same treatment: it stays
-- nullable forever (030's comment).
ALTER TABLE tenants ALTER COLUMN estudio_id SET NOT NULL;
