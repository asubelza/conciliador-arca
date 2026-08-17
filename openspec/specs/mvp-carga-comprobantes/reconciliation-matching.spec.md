# Reconciliation Matching Specification

**Change**: mvp-carga-comprobantes
**Link**: openspec/proposal/mvp-carga-comprobantes.md
**Author**: SDD Executor
**Date**: 2026-08-17
**Status**: Draft — Phase A (Spec)

## Purpose

Match normalized ARCA vouchers against contabilidad vouchers using the exact AFIP composite key `(cuit_emisor, tipo_cbte, punto_venta, numero)`. Perform same-side dedupe before matching, classify results into 5 categories, sort unmatched vouchers by IVA amount (descending), all within a tenant-scoped in-memory `Map` engine with O(n+m) complexity.

## Requirements

### RF-08: Exact key matching with same-side dedupe

The system MUST deduplicate vouchers within the same source (ARCA and contabilidad independently) before matching, then build a `Map<string, ComprobanteCanonical>` keyed by the normalized composite key on the smaller side and probe the larger side.

#### Scenario: ARCA duplicate across overlapping export periods

- GIVEN an ARCA export with two rows for `(30123456789, 1, 1, 0001234)`
- WHEN same-side dedupe runs
- THEN only the first row is kept for matching
- AND the duplicate is counted in `audit_log` with `action = 'dedupe_arca'`

#### Scenario: Exact match probe O(n+m)

- GIVEN 1,000 ARCA vouchers and 950 contabilidad vouchers with 900 exact key overlaps
- WHEN the matching engine runs
- THEN 900 are classified as `matched`
- AND the engine performs exactly 1,000 Map probes (not N×M comparisons)
- AND execution completes in < 500ms

#### Scenario: Tenant isolation on Map probe

- GIVEN two tenants each with 500 vouchers sharing the same composite keys (different tenants)
- WHEN tenant A's matching engine runs
- THEN it builds its Map from tenant A's data only
- AND zero tenant B rows appear in tenant A's results

### RF-09: 5-category classification and IVA priority sort

The system MUST classify each voucher into exactly one of: `matched`, `unmatched-arca`, `unmatched-contabilidad`, `duplicates`, `errors`. Unmatched vouchers MUST be sorted by `iva_amount` descending so the accountant reviews highest-IVA gaps first.

#### Scenario: Classify matched pair

- GIVEN an ARCA voucher `(30123456789, 1, 1, 0001234)` and a contabilidad voucher with the same key
- WHEN matching runs
- THEN both are classified as `matched`
- AND the reconciliation result links them by `reconciliation_id`

#### Scenario: Classify unmatched-A (ARCA only)

- GIVEN an ARCA voucher with no contabilidad counterpart
- WHEN matching runs
- THEN the ARCA voucher is classified as `unmatched-arca`

#### Scenario: Classify unmatched-B (contabilidad only)

- GIVEN a contabilidad voucher with no ARCA counterpart
- WHEN matching runs
- THEN the contabilidad voucher is classified as `unmatched-contabilidad`

#### Scenario: Classify errors

- GIVEN a voucher row with `importe_total_ars = 0` and `tipo_cbte` unknown
- WHEN matching runs
- THEN the row is classified as `errors`

#### Scenario: IVA priority sort on unmatched

- GIVEN 3 unmatched ARCA vouchers with IVA amounts $500, $2000, $50
- WHEN the report is generated
- THEN the first unmatched voucher has IVA $2000, second $500, third $50

## Acceptance Criteria

1. Same-side dedupe removes duplicate composite keys within a source before matching
2. Exact key match uses a tenant-scoped `Map` with O(n+m) complexity
3. Each voucher is classified into exactly one of 5 categories
4. Unmatched vouchers are sorted by IVA amount descending
5. Tenant A cannot see tenant B's data in the Map engine
6. 1,000 + 1,000 voucher match completes in < 5s end-to-end

## Data Schema

```typescript
// Composite key format: "cuit_emisor|tipo_cbte|punto_venta|numero"
type CompositeKey = string;

enum Classification {
  Matched = 'matched',
  UnmatchedArca = 'unmatched-arca',
  UnmatchedContabilidad = 'unmatched-contabilidad',
  Duplicates = 'duplicates',
  Errors = 'errors',
}

interface ReconciliationItem {
  id: string;
  reconciliation_id: string;
  classification: Classification;
  arca_comprobante?: ComprobanteCanonical;
  contabilidad_comprobante?: ComprobanteCanonical;
  iva_amount: number;         // for priority sorting
  created_at: Date;
}
```

### reconciliation_results table

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| tenant_id | uuid FK | |
| job_id | uuid FK | links to background job |
| classification | text | one of 5 enum values |
| composite_key | text | |
| arca_id | uuid FK | nullable |
| contabilidad_id | uuid FK | nullable |
| iva_amount | numeric | for priority sort |
| created_at | timestamptz | |
| Indexes | | `(tenant_id, composite_key)`, `(tenant_id, classification, iva_amount DESC)` |

## TDD Markers

- RED: Dedupe removes duplicates before match — test with seeded duplicate rows
- RED: Classification enum covers all 5 categories — test each with synthetic data
- GREEN: IVA priority sort orders unmatched by amount descending
- GREEN: Tenant Map isolation — cross-tenant data must be absent
- REFACTOR: Extract `CompositeKeyBuilder` and `ClassificationEngine` as pure functions

## Non-Goals / Out of Scope

- Fuzzy matching (Levenshtein, amount/date tolerance) — exact key only
- ML-based prioritization — IVA amount is the sole sorting signal
- Cross-tenant aggregation — each tenant's match is fully isolated
