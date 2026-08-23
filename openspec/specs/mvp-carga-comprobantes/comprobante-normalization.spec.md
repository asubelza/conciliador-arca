# Comprobante Normalization Specification

**Change**: mvp-carga-comprobantes
**Link**: openspec/proposal/mvp-carga-comprobantes.md
**Author**: SDD Executor
**Date**: 2026-08-17
**Status**: Draft — Phase A (Spec)

## Purpose

After staging, raw rows from ARCA and four accounting-system exports (Tango, Bejerman, Xubio, Contabilium) must be normalized into a single canonical `Comprobante` tuple with the AFIP composite key `(cuit_emisor, tipo_cbte, punto_venta, numero)`. This layer handles variant column names, tipo encoding translation, and locale-aware parsing (comma-decimals, dates, currency).

## Requirements

### RF-05: Map ARCA + 4 contabilidad column variants to canonical tuple

The system MUST read each vendor's variant column names and map them to the canonical fields: `cuit_emisor`, `tipo_cbte`, `punto_venta`, `numero`, `fecha_emision`, `importe_total_ars`, `moneda`, `cotizacion`.

#### Scenario: Normalize ARCA "Tipo Doc. Emisor" column

- GIVEN a staged ARCA row with `Nro. Doc. Emisor = "30-12345678-9"`
- WHEN normalization runs
- THEN `cuit_emisor` is stored as `"30123456789"` (punctuation stripped)
- AND `tipo_cbte` is canonicalized from `"1"` → `1` (integer)

**Correction (2026-08-23, real client data):** this scenario originally named `Nro. Doc. Receptor` as the source of `cuit_emisor` — an assumption never checked against a real ARCA export until a client-provided 995-row "Comprobantes Recibidos" file showed `Nro. Doc. Receptor` is constant across the whole file (the estudio's own client — the party *receiving* the comprobante), while `Nro. Doc. Emisor` varies per row (292 distinct vendor CUITs — the party who actually issued it, what reconciliation needs). Also confirmed on that same real export and now handled by `column-adapters.ts`'s `adaptArca`: `Tipo de Comprobante` arrives as `"<código> - <descripción>"` (e.g. `"1 - Factura A"`), not a bare code; and the comprobante number arrives as a `Número Desde`/`Número Hasta` pair rather than a single `Número` column.

#### Scenario: Normalize Tango "CUIT" column

- GIVEN a staged Tango row with `CUIT = "30.12345678.9"` and `Tipo = "Factura A"`
- WHEN normalization runs
- THEN `cuit_emisor` is stored as `"30123456789"`
- AND `tipo_cbte` is canonicalized from `"Factura A"` → `1` (via tipo lookup table)

#### Scenario: Normalize Bejerman "S/Tc" column

- GIVEN a staged Bejerman row with `S/Tc = "FCC"` and `Nro.Comp. = "0001-00001234"`
- WHEN normalization runs
- THEN `tipo_cbte` is canonicalized from `"FCC"` → `3` (Factura C)
- AND `punto_venta` is parsed as `1`, `numero` as `1234`

#### Scenario: Normalize Xubio "tipo" column

- GIVEN a staged Xubio row with `tipo = "NC"` and `importe = "1.500,00"`
- WHEN normalization runs
- THEN `tipo_cbte` is canonicalized from `"NC"` → `3` (NC A) per AFIP tipo map
- AND `importe_total_ars` is stored as `1500.00` (comma-decimal → dot-decimal)

### RF-06: AFIP tipo_cbte canonicalization table

The system MUST maintain a lookup table (`afip_tipo_map`) mapping textual and numeric AFIP tipo codes to the canonical integer code, seeded from ARCA's official `categoria` enum.

#### Scenario: Unknown tipo code in input

- GIVEN a row with `Tipo de Comprobante = "99"`
- WHEN normalization runs
- THEN the row is flagged as `classification = 'errors'`
- AND `importe_total_ars` is stored as `0`
- AND the audit log records `action = 'tipo_lookup_failure'`

#### Scenario: Tipo drift — new AFIP code "20"

- GIVEN ARCA emits a tipo code "20" not in `afip_tipo_map`
- WHEN normalization runs
- THEN the row is classified as `errors`
- AND an operator can add `"20" → 20` to `afip_tipo_map` via seed migration
- AND re-processing the upload succeeds

### RF-07: Locale-aware parsing (decimal, date, currency)

The system MUST parse Argentine locale amounts (comma-decimal, e.g. `"1.500,00"`), dates (`dd/mm/yyyy` or Excel serial), and multi-currency cotización → ARS normalization. NC/ND rows MUST carry a sign consistent with their tipo.

#### Scenario: Comma-decimal importe parsing

- GIVEN a row with `Imp. Total = "1.500,00"`
- WHEN normalization runs
- THEN `importe_total_ars` is stored as `1500.00` (numeric)

#### Scenario: Date opened in Excel (corrupted format)

- GIVEN a row with `Fecha de Emisión = "44197"` (Excel serial for 2021-01-01)
- WHEN normalization runs
- THEN `fecha_emision` is stored as `2021-01-01` (date)

#### Scenario: NC carries negative sign

- GIVEN a row with `Tipo de Comprobante = "3"` (NC A) and `Imp. Total = "500,00"`
- WHEN normalization runs
- THEN `importe_total_ars` is stored as `-500.00` (negative sign for nota de crédito)

## Acceptance Criteria

1. All four contabilidad column variants (Tango, Bejerman, Xubio, Contabilium) normalize to the same canonical tuple
2. CUIT is stripped to 11 digits for all sources
3. Tipo text ↔ integer mapping resolves via `afip_tipo_map`
4. Comma-decimal amounts parse without Excel corruption
5. Dates parse from `dd/mm/yyyy` and Excel serial
6. NC/ND rows carry correct negative sign
7. Unknown tipo codes → classification `errors` (not crash)

## Data Schema

```typescript
// Canonical Comprobante DTO
interface ComprobanteCanonical {
  cuit_emisor: string;        // 11-digit, no punctuation
  tipo_cbte: number;          // AFIP canonical integer
  punto_venta: number;
  numero: number;
  fecha_emision: string;      // ISO date YYYY-MM-DD
  importe_total_ars: number;  // ARS, signed (NC/ND negative)
  cae?: string;
  moneda: string;             // "ARS" always after normalization
  cotizacion?: number;
  file_source: 'arca' | 'contabilidad';
  source_row: jsonb;          // raw row for traceability
}
```

### afip_tipo_map table

| Column | Type | Notes |
|--------|------|-------|
| id | serial PK | |
| codigo_afip | text | AFIP tipo code (e.g. "1") |
| label | text | Human label (e.g. "Factura A") |
| canonical_code | integer | AFIP integer (e.g. 1) |
| signs_debit | boolean | true for NC/ND (negative importe) |

## TDD Markers

- RED: Normalization service returns canonical tuple before it exists
- RED: Unknown tipo → classification `errors` before error path is wired
- GREEN: Comma-decimal, date, sign all parse correctly
- GREEN: Snapshot tests on real ARCA + Contabilium sample rows
- REFACTOR: Column-variant mapping via a config-driven adapter per source system

## Non-Goals / Out of Scope

- Fuzzy/normalized matching based on amount or date tolerance — exact key only
- Multi-currency support beyond ARS normalization — all amounts in ARS
- Real-time tipo map updates — seeded via migration, operator updates require re-deploy
