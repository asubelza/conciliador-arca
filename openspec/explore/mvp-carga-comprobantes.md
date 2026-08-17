# Exploration: Motor de carga y cruce determinístico para comprobantes ARCA vs sistema contable

## Problem Space

`conciliador-arca` is a greenfield monorepo (Next.js 14 + Tailwind / NestJS + PostgreSQL / Clerk) that must reconcile a client's ARCA tax-authority comprobantes against the same comprobantes recorded in their accounting system (Tango, Bejerman, Xubio, Contabilium). The MVP is a **deterministic load + match engine**: the accountant (an "abogado contador") uploads two exports — ARCA and contador — and the engine classifies each voucher as matched / unmatched-A / unmatched-B and reports the diff. Today there is zero code; the stack is declared-but-not-scaffolded, so this exploration is research-grounded, not code-grounded.

## 1. File Format Analysis

### 1.1 ARCA exports

There are two ARCA access surfaces, with **very different** data shapes:

**A) "Mis Comprobantes" web portal — XLSX/CSV export (what users actually upload).** Columns observed from SOS-Contador / Afip SDK extraction (Español, Argentina locale):

| Field (ARCA label) | Meaning |
|---|---|
| Fecha de Emisión | Emission date |
| Tipo de Comprobante | AFIP numeric code (1=Factura A, 2=ND A, 3=NC A, 6=FB, 7=ND B, 8=NC B, 11=Factura C …) |
| Punto de Venta | Sales point |
| Número Desde / Número Hasta | Voucher range (usually identical → single voucher) |
| Cód. Autorización | CAE |
| Tipo Doc. Receptor | 80 = CUIT |
| Nro. Doc. Receptor | CUIT of the *receptor* (when file is "Recibidos") |
| Denominación Receptor | Counterpart name |
| Tipo Cambio / Moneda | "1,00" / "PES" |
| Imp. Neto Gravado / No Gravado / Op. Exentas / Otros Tributos / IVA / **Imp. Total** | Amounts, comma-decimals |

**B) WSBFEV1 web service (XML) — only programmatic path**, used by Afip SDK. XML fields include `Tipo_cbte`, `Punto_vta`, `Cbte_nro`, `Tipo_doc`, `Nro_doc`, `Imp_total`, `Fecha_cbte`, `Imp_moneda_Id`, `Imp_moneda_ctz`, etc. This service is used for **emitted** vouchers; **there is no public web service for *received* vouchers** — the only way to get a client's received comprobantes is for the *client* to manually export the CSV from the ARCA portal. (Confirmed: "ARCA no publica un servicio web para consultar los comprobantes que tus proveedores le informaron a tu CUIT… El único camino disponible hoy es exportar el CSV desde 'Mis Comprobantes → Recibidos'." — YoFacturo docs.)

**Parsing gotchas (real, confirmed):**
- CSV opened in Excel corrupts date format (ARCA/YoFacturo/Xubio all warn: "NO ABRIR EL CSV EN EXCEL"). Must parse with a tolerant date parser and locale-aware decimal ("," → ".").
- Multi-currency: amounts may be in original currency + cotización; reconciler must normalize to ARS for matching tolerance.
- Notas de crédito/debito are **restados** conceptually but the export sums them; sign handling must be explicit per tipo.
- File naming embeds CUIT (`Mis Comprobantes Recibidos - CUIT XXXXXXXXXXX.xlsx`).

### 1.2 Accounting-system exports

The reconcilable surface is the **comprobante encabezado** (not asientos). Common columns across systems:

| Sistema | Formato | Columnas reconciliables |
|---|---|---|
| **Tango** (Axoft) | XLS (Libro IVA Ventas/Compras) | fecha, tipo, número, PV, proveedor/cliente, CUIT, importe total, IVA discriminado. Also supports import *from* Mis Comprobantes / RG 3685 / Libro IVA Digital. |
| **Bejerman** | ASCII fixed-format ("Exportador de Comprobantes") + asientos USUARIO*.IMP | S/Tc Nro.Comp. dd/mm/aaaa; agrupa por sigla/tipo/número; importa desde Excel/Mis Comprobantes. |
| **Xubio** | CSV / Excel / TXT (Libro Mayor, Libro IVA) | fecha, tipo, número, CUIT, importe; exporta a formato ARCA. |
| **Contabilium** | Excel (libro diario/mayor) | importador masivo de comprobantes; multi-cliente fluido. |

**Key realization:** all four systems can export/produce a row per comprobante with at least (CUIT, tipo, PV, número, fecha, importe total). That is the exact same tuple ARCA carries. → **a single canonical normalization layer** can ingest all four if we map each source's column names → the canonical tuple. The hard part is *variant* column names and *variant* tipo encodings (text "Factura A" vs numeric "1").

### 1.3 Canonical voucher tuple (the single source of truth)

```
Comprobante = (cuit_emisor, tipo_cbte, punto_venta, numero, fecha_emision,
               importe_total_ars, cae?, moneda, cotizacion?)
```

The **AFIP unique key** = `(tipo_cbte, punto_venta, cbte_nro)` per emisor CUIT. This is the natural exact-match key. All matching decisions reduce to this tuple.

## 2. Matching Algorithm Research

### 2.1 Deterministic / exact phase (the MVP core)

- Primary key: normalize CUIT (strip `-`, `.`), canonicalize tipo to AFIP numeric code, normalize numero (int), PV (int).
- Index one side (the smaller — by row count) in an in-memory `Map<string, Comprobante>` keyed by the normalized composite. Probe the larger side. **O(n + m)**, memory bounded by the smaller side.
- Same-side dedupe first (ARCA can return duplicates across overlapping export periods; SOS warns about this).

### 2.2 Fuzzy phase (MVP stretch / follow-on)

Exact won't match when data is slightly off. Approaches, ranked by reliability:

| Signal | Technique | Tolerance |
|---|---|---|
| CUIT | Strip punctuation; strip "CUIT" prefix | exact (normalized) |
| Tipo | Numeric ↔ text map (Factura A↔1) | exact mapped |
| Número | int parse; Levenshtein on stringified for typos | exact + low-dist |
| Importe | Decimal compare with ε (currency rounding) | ±0.01–1.00 ARS (configurable) |
| Fecha | |date| ≤ N days (N=0,1,2 configurable) |

Secondary index by `(cuit, numero)` with amount-band + date-window probe for rows that failed exact match. This is the standard accounting-reconciliation pattern (Bank-statement reconciliation in reverse: we know the voucher exists, we're finding where we recorded it).

## 3. Multi-Tenant Architecture Patterns

**Tenancy grain = a client empresa** (an accountant's client has its own CUIT; each reconciliation is per-CUIT). An accountant tenant may own many client empresa-tenants.

| Pattern | When it fits | Tradeoffs for this app |
|---|---|---|
| **Shared schema + tenant_id + RLS** (default) | Many small tenants (countable accountants × clients) | Lowest ops cost; single DDL migrations; must index `tenant_id` as leading col + force RLS; weaker blast radius. Matches the NestJS + Postgres stack. |
| **Schema-per-tenant** (`search_path` routing) | Few large enterprise tenants (<500) | Per-tenant `pg_dump` is trivial; but N-schema migrations + pg_catalog bloat past ~1K schemas; PgBouncer must run **session mode** (discards `search_path`). |
| **Database-per-tenant / Neon** | HIPAA/strict compliance, very large tenants | Strongest isolation + per-tenant PITR; but cross-tenant reporting needs `postgres_fdw`; provisioning overhead. |
| **Hybrid tier** | Power-law customer base | Free tier on shared+RLS; route enterprise to dedicated DB. This is the mature end-state. |

**Decision signal from research:** shared schema + RLS is the correct **day-1/2 default** for "accountants with many clients", *provided* we (a) put `tenant_id` as the leading column of every composite index, (b) treat RLS as a safety net with app-layer tenant scoping as primary gate, and (c) design for a future split point. Schema-per-tenant is explicitly discouraged at scale by multiple 2025/2026 sources (catalog bloat, migration pain, PgBouncer session-mode trap).

## 4. Performance Considerations (thousands of vouchers)

The MVP deals in *thousands* per upload, not millions — but the architecture must stay bounded.

**File → API → DB pipeline (no whole-file buffering):**
- Frontend: stream the upload to the API (`/api/reconciliations` multipart, `highWaterMark` tuned) rather than parsing XLS in the Vercel serverless function (memory-capped, 15-min max).
- API (NestJS): `fs.createReadStream` → streaming XLS/CSV parser → `pipeline()` (never `.pipe()`, which leaks on error). Bounded `highWaterMark`.
- Staging table (`staging_import` unindexed): `COPY FROM STDIN` via `pg-copy-streams` (~112k rows/sec vs 24k batched INSERT vs 177 rows/sec single). Drop indexes before load, rebuild after — this is a 3–4× win documented in the literature.
- Transform stage: dedupe + canonicalize + `INSERT … SELECT` into `comprobante` (tenant-scoped).
- Match stage: build `Map` per tenant from the smaller set; O(n+m) exact probe.
- CPU-heavy parse/xlsx: offload to `worker_threads` or a **BullMQ** background job so the HTTP returns a job id + status polling, keeping Vercel/NestJS responsive.

**Concrete throughput target (from research):** batch 1000–5000 rows, `COPY` staging (~112k r/s), Map-probe match O(n+m). "Thousands" completes in well under a second; the architecture survives a 10× surprise.

**PostgreSQL tuning nuggets (from sources):** composite index `(tenant_id, cuit_emisor, tipo_cbte, punto_venta, numero)`; `FORCE ROW LEVEL SECURITY` so table owner can't bypass in tests; RLS policies use `current_setting('app.tenant_id')` set per-session (not per-tenant Postgres roles).

## Approach Comparison

| # | Approach | Pros | Cons | Effort |
|---|---|---|---|---|
| **A. Single shared schema + RLS + streaming `COPY` + Map-match** | Day-1 default; low ops; matches stack; migrates later | Need app-layer tenant scoping discipline; weaker isolation at scale | S |
| **B. Hybrid tier (shared+RLS for free, schema-per-tenant/DB for enterprise)** | Isolation path already planned; scales to enterprise | More routing complexity upfront; migration split-point engineering | M |
| **C. Schema-per-tenant from day one** | Strong isolation; trivial per-tenant pg_dump | Migration pain at >500 tenants; PgBouncer session-mode trap; catalog bloat | M (but tech-debt) |

## Recommended Approach

**Approach A for the MVP**, deliberately architected for **Approach B** as the exit path:

- One schema, `comprobante`/`reconciliation` tables with `tenant_id` leading every index.
- RLS policies as backstop (`current_setting('app.tenant_id')`); NestJS `CLERK` middleware sets tenant from the authenticated user's selected empresa.
- Ingest: stream upload → staging `COPY` → canonicalize → match via tenant-scoped `Map`.
- Defer multi-schema/DB tenancy until a concrete enterprise/isolation driver appears (then route by a tenant→backend map). This matches every 2025/2026 multi-tenant benchmark guidance ("start with RLS; switch when pain forces you").

## Key Decisions Needed

1. **CUIT as tenant_id?** — tenant grain. Decide: tenant = accountant firm, or tenant = client empresa (CUIT). Affects index design + Clerk org model.
2. **Received-voucher ingestion** — ARCA has no WS for received; the flow must be **upload-by-accountant-of-client's-CSV** (or client uploads themselves). Product decision on UX ownership.
3. **Tipo canonicalization** — maintain an AFIP `tipo_cbte` ↔ label map (Factura A↔1, etc.) as a config table. Needed before matching.
4. **Fuzzy tolerance policy** — define exact ε for importe (ARS, default ±1.00) and date window N (default 1 día) for unmatched review.
5. **Job vs inline** — decide whether reconciliation is a synchronous HTTP response (fine for thousands) or a background job (BullMQ) with status polling. Ties to infra budget.
6. **Postgres tenancy split point** — if/when to add schema-per-tenant routing. Capture now to avoid schema regret.

## Risks

- **Product/UX risk (highest):** ARCA cannot be scraped for received comprobantes; success depends on the accountant or client actually uploading the CSV. If adoption of the upload step is low, the product has no data — a business risk, not a technical one.
- **Parsing fragility:** Excel/CSV locale corruption (dates, comma-decimals), multi-currency normalization, sign of notas crédito. A single bad normalization silently breaks matches.
- **Tenant-isolation regression:** RLS is a backstop; a future dev writing a query that forgets `tenant_id` could leak rows. Must be covered by tests with `FORCE ROW LEVEL SECURITY` and a non-superuser test role.
- **Vercel serverless memory** on XLS parse — can OOM on a real 50k-row export. Must stream to API + background job, not parse in the serverless function.
- **AFIP tipo_cbte drift** — AFIP occasionally adds/amends tipo codes; the canonicalization map must be versioned and updatable, not hardcoded.
- **Greenfield validation debt** — stack/test commands are declared, not yet installed; any perf claim here is research-based and must be re-validated once Jest/NestJS scaffolding exists.

## Estimated Effort

**T-shirt: S** (for the deterministic, single-tenant-per-upload core of the MVP). The *matching engine itself* — stream → staging COPY → canonicalize → Map exact-match → report diff — is a compact, well-bounded slice (~3 NestJS endpoints + streaming service + Postgres staging tables + Jest specs). The **M** effort is in multi-tenant hardening (RLS policies that survive tests, tenant-id propagation, enterprise split-point) and the **fuzzy** phase (secondary indexing, tolerance config, confidence scoring). Recommend the proposal scope the deterministic core + strict TDD, and defer fuzzy + schema-per-tenant to follow-ons.

## Ready for Proposal

**Yes.** The problem is well-bounded, the canonical tuple and exact-match key are confirmed against real ARCA + contabilidad exports, and the architecture (shared schema + RLS + streaming `COPY` + Map-match) is research-validated. Proposal should: (1) scope In = upload two files → deterministic reconcile → diff report, strict TDD; (2) defer fuzzy, multi-schema tenancy, and background-job queueing to stretch goals; (3) capture the 6 key decisions as open questions for the spec phase.
