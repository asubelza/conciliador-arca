# Proposal: mvp-carga-comprobantes

## Intent
Enable accountants to upload an ARCA "Mis Comprobantes" received-voucher export plus their accounting-system export (Tango/Bejerman/Xubio/Contabilium), deterministically reconcile them by exact AFIP composite key, classify results into 5 categories, prioritize unmatched vouchers by IVA amount, and export a diff report with a full immutable audit trail.

## Scope

### In Scope
- Two-file upload (ARCA received CSV/XLSX + contabilidad export) via Next.js frontend streamed to NestJS
- Normalization layer mapping variant column names + tipo encodings to the canonical AFIP composite key `(cuit_emisor, tipo_cbte, punto_venta, numero)`
- Staging table (unindexed) + `COPY FROM STDIN` → canonicalize → tenant-scoped `Map` exact-match engine (O(n+m))
- Same-side dedupe before match; 5-category classification (matched / unmatched-A / unmatched-B / duplicates / errors)
- IVA-amount priority sorting of unmatched vouchers
- CSV diff report export + immutable `audit_log` (tenant, user, action, file, counts)
- Shared schema + RLS tenancy (`tenant_id` leading every index; app-layer scoping as primary gate)

### Out of Scope
- Fuzzy matching (Levenshtein, amount/date tolerance) — deferred to stretch
- ML-based prioritization — out of MVP
- Schema-per-tenant / database-per-tenant — enterprise split-point, deferred
- Automated ARCA fetch — no WS exists for received vouchers
- Client-facing portal / mobile app — accountant-facing desktop UX only

## Capabilities

### New Capabilities
- `voucher-ingestion`: stream multipart upload → staging `COPY FROM STDIN` via NestJS + BullMQ background job
- `comprobante-normalization`: map ARCA + 4 contabilidad column variants → canonical AFIP tuple + `tipo_cbte` lookup table
- `reconciliation-matching`: tenant-scoped `Map` exact-match engine O(n+m), 5-category classification, IVA priority sort
- `reconciliation-reporting`: CSV diff report export + immutable audit trail

### Modified Capabilities
None — no existing specs are changed.

## Approach
Stream uploads from the Next.js frontend to NestJS (avoiding Vercel serverless XLS-parse OOM), stage rows via `COPY FROM STDIN` into an unindexed staging table (indexes dropped pre-load, rebuilt post-load), then canonicalize + dedupe + Map-probe the smaller set against the larger in O(n+m). Shared PostgreSQL schema with `tenant_id` as the leading index column and RLS as backstop, with Clerk middleware setting `app.tenant_id` per session. (Approach A from exploration — research-validated, deliberately architected for the schema-per-tenant enterprise exit path.)

## Architecture Outline (draft)
- **Frontend** (Next.js 14 + Tailwind / Clerk): upload form, file/header validation, progress indicator, diff report viewer, tenant selection
- **API** (NestJS): `reconciliations.controller` (multipart), `ingestion.service` (stream → staging COPY), `normalization.service` (tipo map + tuple canonicalization), `matching.service` (tenant-scoped Map probe + dedupe + classify + IVA sort), `reporting.service` (CSV diff + audit write)
- **Queue** (BullMQ + Redis): background job for XLS parse → staging → match → report; HTTP returns job id + poll status
- **DB** (PostgreSQL shared schema + RLS): `tenant`, `comprobante`, `reconciliation`, `reconciliation_item`, `audit_log`, `staging_import` (unindexed, ephemeral); RLS policy keyed on `app.tenant_id`; `FORCE ROW LEVEL SECURITY` in tests
- **Audit trail**: append-only `audit_log` recording upload, normalize, match, export events per tenant

## Task Breakdown Estimate

| #  | Task (TDD)                                              | Effort |
|----|---------------------------------------------------------|--------|
| 1  | Scaffold monorepo + NestJS/Next/Jest; shared-types; test commands | S |
| 2  | Seed AFIP `tipo_cbte` canonicalization table + migration down | S |
| 3  | Stream upload endpoint → staging `COPY FROM STDIN` (reject bad encoding) | M |
| 4  | Normalization: ARCA + 4 contabilidad column variants → canonical tuple | S |
| 5  | Same-side dedupe before match (overlapping export ranges) | S |
| 6  | Exact-match engine: tenant-scoped `Map` probe O(n+m)   | M |
| 7  | 5-category classification (matched/unmatched-A/unmatched-B/dup/errors) | S |
| 8  | IVA-amount priority sort on unmatched vouchers         | S |
| 9  | CSV diff report export (matched + both unmatched sides + deltas) | M |
| 10 | Audit trail: immutable log of upload/reconcile/export  | S |
| 11 | Tenant isolation: RLS + `FORCE ROW LEVEL SECURITY` + leak test | M |
| 12 | Frontend upload form + diff viewer (Next.js + RTL)     | S |

## Affected Areas

| Area                                  | Impact | Description |
|---------------------------------------|--------|-------------|
| `packages/api/src/reconciliations/`   | New    | Ingestion, normalization, matching, reporting endpoints + services |
| `packages/api/src/tenant/`            | New    | Clerk middleware, RLS policies, `app.tenant_id` session setter |
| `packages/web/src/`                   | New    | Upload form, progress, diff report viewer |
| `packages/shared-types/src/`          | New    | Canonical `Comprobante`, `ReconciliationResult` types |
| `db/migrations/`                      | New    | Schema: `comprobante`, `reconciliation`, `reconciliation_item`, `audit_log`, `staging_import`, RLS |
| `db/seed/`                            | New    | AFIP `tipo_cbte` lookup table |

## Risks

| # | Risk | Likelihood | Mitigation |
|---|------|------------|------------|
| 1 | Parsing fragility — Excel/CSV corrupts dates + comma-decimals; multi-currency normalization; NC/ND sign handling breaks matches silently | High | Tolerant date parser, locale-aware decimal (`,`→`.`), explicit per-tipo sign rules, snapshot tests on real ARCA + Contabilium samples |
| 2 | ARCA has no WS for received vouchers — adoption depends on accountant/client uploading CSV; no data = no product | High | Filename CUIT extraction, header/encoding validation rejecting bad files, clear upload UX with error messaging |
| 3 | Tenant-isolation regression — RLS is backstop; a query forgetting `tenant_id` leaks rows | Med | `FORCE ROW LEVEL SECURITY`, non-superuser test role, app-layer tenant scoping as primary gate, dedicated isolation unit test |

## Rollback Plan
- **DB**: all schema changes in idempotent migrations with `down`; `down` drops staging/audit tables, reverts RLS policies, removes `tenant_id` columns. No destructive ops on existing tables (greenfield).
- **Feature flag**: `RECONCILIATION_MVP_ENABLED` gates upload/match/export endpoints — flipping off returns 501, leaving existing API surface untouched.
- **Frontend**: upload form behind a feature toggle; revert = toggle flip + atomic monorepo `git revert` of deploy commit.
- **Audit trail**: append-only — rollback = `DELETE ... WHERE tenant_id = ?` (never `TRUNCATE`).
- **Background job**: BullMQ queue drained before redeploy; orphaned jobs cleared via queue `drain()`.

## Dependencies
- ARCA "Mis Comprobantes" received-voucher CSV/XLSX sample exports (normalization tests)
- Accounting-system export samples (Tango / Bejerman / Xubio / Contabilium)
- Clerk auth (declared; needed for tenant extraction)
- BullMQ + Redis (declared; for background ingestion)

## Success Criteria

- [ ] Upload + deterministic reconcile of two 1,000-row exports completes ≤ 5s end-to-end (stream → staging COPY → Map-match); identical inputs yield 100% exact-tuple matches.
- [ ] 5-category classification produces a diff report with 0 false-match errors on a seeded dataset of 200 matched + 50 unmatched vouchers.
- [ ] Tenant isolation: authenticated user of tenant A reads zero rows belonging to tenant B (verified by automated RLS leak test with `FORCE ROW LEVEL SECURITY`).
