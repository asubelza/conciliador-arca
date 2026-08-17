# Design: mvp-carga-comprobantes

## Technical Approach

Stream two-file upload (ARCA + contabilidad CSV/XLSX) from Next.js 14 frontend to NestJS via multipart streaming — never parsing XLS server-side on Vercel. NestJS ingests rows through `COPY FROM STDIN` into an unindexed `vouchers_staging` table inside a BullMQ background job. A normalization service maps vendor-specific columns to the canonical AFIP composite key `(cuit_emisor, tipo_cbte, punto_venta, numero)` using an `afip_tipo_map` lookup. A tenant-scoped `Map`-probe engine dedupes, matches (O(n+m)), classifies into 5 categories, and sorts unmatched by IVA amount. Results persist to `reconciliation_results`; a reporting service generates CSV/Excel diff reports and writes append-only `audit_trail` entries. All DB access enforces `tenant_id` via RLS as backstop, with app-layer scoping as primary gate.

**Spec references**: RF-01 to RF-07 (ingestion + normalization), RF-08 to RF-09 (matching), RF-10 to RF-11 (reporting).

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|----------|--------|-------------|-----------|
| Tenancy model | Shared schema + `tenant_id` leading index + RLS | Schema-per-tenant, DB-per-tenant | Greenfield; low ops cost; matches NestJS+Postgres stack; exit path to enterprise is a future tenant→backend router |
| File parsing | Stream to NestJS, parse in BullMQ worker | Parse in Vercel serverless fn | Vercel serverless has 15-min timeout + memory cap; XLS parse OOMs on 50k-row exports |
| Staging strategy | Unindexed table + `COPY FROM STDIN` | Batched INSERT | COPY ~112k r/s vs batched INSERT ~24k r/s; drop indexes pre-load, rebuild post-load |
| Match engine | In-memory tenant-scoped `Map` | SQL join | O(n+m); memory bounded by smaller side; deterministic and testable |
| Queue | BullMQ + Redis | In-process job, Celery | Background job keeps HTTP responsive; returns job_id + poll status (RF-04) |
| Report export | CSV + XLSX via streaming | Static report | On-demand download; XLSX uses multiple sheets (Matched/Unmatched-A/Unmatched-B/Errors) |
| Tenant session | `app.tenant_id` per-session via Clerk middleware | Per-tenant Postgres roles | Avoids N-role management; RLS uses `current_setting('app.tenant_id')` |

## Component Diagram

```
┌──────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────┐
│  Next.js │────▶│ API Gateway  │────▶│ Ingestion    │────▶│ BULLMQ   │
│ 14 App   │     │ (NestJS)     │     │ Service      │     │ Worker   │
│ Upload   │     │ multipart    │     │ stream→COPY  │     │ Queue    │
└──────────┘     └──────────────┘     └──────┬───────┘     └────┬─────┘
                                               │                  │
                                    ┌─────────▼──────────┐       │
                                    │ Normalization       │ ◀─────┘
                                    │ Service             │
                                    │ tipo map + tuple    │
                                    └─────────┬──────────┘
                                              │
                                    ┌─────────▼──────────┐
                                    │ Matching Engine     │
                                    │ Map dedupe+match    │
                                    │ 5-classify + IVA    │
                                    └─────────┬──────────┘
                                              │
                          ┌───────────────────┼──────────────────┐
                          │                   │                  │
                   ┌──────▼──────┐    ┌───────▼───────┐   ┌──────▼──────┐
                   │ vouchers_   │    │ reconcilia-   │   │ audit_trail │
                   │ staging     │    │ tion_results  │   │ (append-   │
                   │ (staging)   │    │ (matched/     │   │  only)      │
                   └─────────────┘    │ unmatched)    │   └─────────────┘
                                       └───────────────┘
                                              │
                                    ┌─────────▼──────────┐
                                    │ Reporting Service  │
                                    │ CSV/Excel export   │
                                    └─────────┬──────────┘
                                              │
                                    ┌─────────▼──────────┐
                   ┌────────────────│  PostgreSQL (PG)   │
                   │  shared schema │  RLS + tenant_id   │
                   └────────────────└────────────────────┘
```

## Data Flow

```
Upload:
  Frontend ─(stream multipart)→ NestJS POST /api/reconciliations
    → validate file type + size (reject >50MB, reject non-whitelist)
    → enqueue BullMQ job (return job_id + status_url)
    → HTTP 202

Job (BullMQ worker):
  1. fs.createReadStream → XLS/CSV streaming parser → pipeline()
  2. COPY FROM STDIN → vouchers_staging (unindexed, file_source tagged)
  3. Drop indexes, insert rows, rebuild indexes
  4. Normalize: column-variant adapters → ComprobanteCanonical via afip_tipo_map
  5. Same-side dedupe (composite key → first wins)
  6. Tenant-scoped Map: build on smaller side, probe larger side
  7. Classify: matched / unmatched-arca / unmatched-contabilidad / duplicates / errors
  8. Sort unmatched by IVA amount DESC
  9. Persist reconciliation_results (tenant_id indexed)
  10. Write audit_trail entry (upload, normalize, match)

Report:
  GET /api/reconciliations/:jobId/report?format=csv|xlsx
    → read reconciliation_results (tenant-scoped)
    → stream CSV or generate XLSX sheets
    → audit_trail entry (export)
```

## Database Schema

```sql
-- tenants: accountant firm or client empresa
CREATE TABLE tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  cuit        TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- vouchers_staging: unindexed, ephemeral, per-job
CREATE TABLE vouchers_staging (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  job_id      UUID,
  file_source TEXT NOT NULL CHECK (file_source IN ('arca', 'contabilidad')),
  row_data    JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- vouchers_canonical: normalized comprobantes
CREATE TABLE vouchers_canonical (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  cuit_emisor    TEXT NOT NULL,
  tipo_cbte      INTEGER NOT NULL REFERENCES afip_tipo_map(canonical_code),
  punto_venta    INTEGER NOT NULL,
  numero         INTEGER NOT NULL,
  fecha_emision  DATE,
  importe_total_ars NUMERIC,
  cae            TEXT,
  moneda         TEXT,
  cotizacion     NUMERIC,
  file_source    TEXT NOT NULL,
  source_row     JSONB,
  created_at     TIMESTAMPTZ DEFAULT now(),
  INDEX idx_vouchers_tenant_key (tenant_id, cuit_emisor, tipo_cbte, punto_venta, numero)
);

-- reconciliation_results: 5-category classification
CREATE TYPE classification_enum AS ENUM (
  'matched', 'unmatched-arca', 'unmatched-contabilidad', 'duplicates', 'errors'
);
CREATE TABLE reconciliation_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  job_id          UUID NOT NULL,
  classification  classification_enum NOT NULL,
  composite_key   TEXT NOT NULL,
  arca_id         UUID REFERENCES vouchers_canonical(id),
  contabilidad_id UUID REFERENCES vouchers_canonical(id),
  iva_amount      NUMERIC,
  created_at      TIMESTAMPTZ DEFAULT now(),
  INDEX idx_recon_tenant_class (tenant_id, classification, iva_amount DESC),
  INDEX idx_recon_tenant_key (tenant_id, composite_key)
);

-- audit_trail: immutable append-only log
CREATE TABLE audit_trail (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  user_id     TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('upload','staging','normalize','match','export','user_mark','feedback_read')),
  file_name   TEXT,
  counts      JSONB,
  created_at  TIMESTAMPTZ DEFAULT now()
);
REVOKE UPDATE, DELETE ON audit_trail FROM app_role;

-- afip_tipo_map: canonical AFIP tipo code lookup
CREATE TABLE afip_tipo_map (
  id              SERIAL PRIMARY KEY,
  codigo_afip     TEXT NOT NULL,
  label           TEXT NOT NULL,
  canonical_code  INTEGER UNIQUE NOT NULL,
  signs_debit     BOOLEAN NOT NULL DEFAULT false
);

-- RLS policy (backstop, app-layer scoping is primary gate)
ALTER TABLE vouchers_staging    ENABLE ROW LEVEL SECURITY;
ALTER TABLE vouchers_canonical  ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_trail         ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON vouchers_staging
  FOR ALL USING (tenant_id = current_setting('app.tenant_id')::uuid);
-- Repeat for each tenant-scoped table
```

## Security

| Concern | Measure |
|---------|---------|
| Tenant isolation | App-layer `tenant_id` scoping (primary); RLS policy as backstop; `current_setting('app.tenant_id')` set via Clerk middleware |
| RLS enforcement | `FORCE ROW LEVEL SECURITY` in tests; non-superuser test role |
| CORS | Whitelist frontend origin; credentials for Clerk session |
| File type | Whitelist `.csv`, `.xlsx`, `.xls`; reject all others (HTTP 415) |
| File size | 50 MB hard limit per file (HTTP 413) |
| Audit integrity | `REVOKE UPDATE, DELETE` on `audit_trail` from app role; append-only |

## Deployment

- **Frontend**: Vercel (Next.js 14 App Router + Tailwind + Clerk)
- **API**: Railway/Render (NestJS + Prisma + BullMQ worker + PostgreSQL)
- **DB**: Managed PostgreSQL (shared schema, `tenant_id` leading every index)
- **Cache/Queue**: Redis (managed) for BullMQ
- **Migrations**: `db/migrations/` — idempotent, with `down` for all

## Error Handling Strategy

- **Partial failures**: A row that fails normalization is classified as `errors`, not fatal. The job continues processing remaining rows.
- **Retry logic**: BullMQ retries failed jobs 3× with exponential backoff (1s, 4s, 9s).
- **Dead-letter queue**: After 3 retries, job moves to `bullmq:dlinq` and an `audit_trail` entry with `action='job_error'` is written. HTTP poll returns `{ status: 'error' }`.
- **Stuck jobs**: Manual `drain()` on queue during rollback per proposal rollback plan.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | `CompositeKeyBuilder`, `NormalizationService`, `ClassifyEngine` | Jest — pure function tests with synthetic + real ARCA/Contabilium sample rows |
| Unit | `StagingImportService` (COPY streaming) | Jest + `pg-mem` — assert row count, file_source tagging |
| Integration | API endpoints | Supertest — HTTP 202, 400, 413, 415, poll status; RLS leak test with `FORCE ROW LEVEL SECURITY` |
| Integration | Full pipeline | One job-processed test with 200 matched + 50 unmatched seeded rows; assert 0 false-match errors |
| E2E | Frontend upload form + diff viewer | React Testing Library — file selection, progress, report rendering |
| Coverage | All layers | Target 80% (config.yaml: `coverage_threshold: 80`) |
| TDD | Strict | RED → GREEN → REFACTOR for every task; `capture_prompt: false` for SDD artifacts |

## Rollout Plan

1. **Feature flag**: `RECONCILIATION_MVP_ENABLED` gates upload/match/export endpoints (501 when off)
2. **Canary**: Deploy to one accounting firm (single tenant) via Clerk org targeting
3. **RLS hardening**: `FORCE ROW LEVEL SECURITY` + dedicated isolation unit test before wider release
4. **Cutover**: Remove flag after 2 weeks of stable metrics (≤5s for 1,000+1,000 rows, 0 leak-test failures)

## Open Questions

- [ ] RF-01: Confirm 50 MB limit is sufficient for 10k-row XLSX exports (real-world file size TBD)
- [ ] RF-02: Confirm `xlsx` vs `xls` MIME detection edge cases (libreoffice saves)
- [ ] RF-03: Redis memory budget for staging large uploads — confirm BullMQ job size won't exceed queue limits
