-- 001_init_tenants.sql
-- tenants: accountant-firm / client-empresa grain. Every other table is scoped
-- to a tenant_id; tenancy decisions per openspec/designs/mvp-carga-comprobantes/architecture.md.

CREATE TABLE tenants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  cuit       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
