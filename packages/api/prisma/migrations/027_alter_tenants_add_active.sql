-- 027_alter_tenants_add_active.sql
-- Tenant disable/enable toggle (backoffice self-service), mirroring
-- users.is_active (018_init_users_and_roles.sql) for the tenant side.
--
-- Scope decided with the client: disabling a tenant blocks ONLY `cliente`
-- role users scoped to that tenant (see tenant-access.ts's assertTenantAccess,
-- cliente branch). Staff roles (admin/colaborador) are NOT blocked from a
-- disabled tenant — they can still view/operate it, e.g. to reactivate it or
-- do cleanup. Defaults to true so every existing tenant stays enabled.
ALTER TABLE tenants ADD COLUMN active boolean NOT NULL DEFAULT true;
