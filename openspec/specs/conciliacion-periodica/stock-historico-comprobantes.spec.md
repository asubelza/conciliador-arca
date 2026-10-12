# Stock Histórico de Comprobantes Specification

**Change**: conciliacion-periodica
**Link**: openspec/proposal/conciliacion-periodica.md
**Author**: Claude
**Date**: 2026-08-22
**Status**: Draft — Phase A (Spec)

## Purpose

Turn `vouchers_canonical` from an unused table (see `openspec/progress/PR-3.md`, Deviations #2) into the real persistent stock of ARCA vouchers that survives across períodos, with a state (`pendiente`/`conciliado`) each voucher carries forward. This is the prerequisite everything else in `conciliacion-periodica` depends on.

## Requirements

### RF-14: Unify the two incompatible tipo_cbte encodings before anything writes to vouchers_canonical

The system MUST use the real AFIP integer tipo codes (the same ones `afip-tipo-lookup.ts`/`CanonicalVoucher.tipo_cbte` already resolve every row to) as the sole encoding for `afip_tipo_map`/`vouchers_canonical.tipo_cbte` — not the legacy zero-padded 3-digit scheme from migrations 002/004 (T01/T02), which was never connected to any real adapter and would silently produce wrong data if used as-is.

#### Scenario: afip_tipo_map is seeded with real AFIP codes, not the legacy 3-digit scheme

- GIVEN the migrations have run against a fresh database
- WHEN `afip_tipo_map` is queried
- THEN it contains rows keyed by the real AFIP integer codes (`1`, `2`, `3`, `6`, `7`, `8`, `11`, `12`, `13`, `19`, `20`, `21`, at minimum — the same set `KNOWN_AFIP_CODES` in `afip-tipo-lookup.ts` already recognizes)
- AND it does NOT contain the legacy `'001'`/`'003'`/`'004'` style rows

#### Scenario: vouchers_canonical.tipo_cbte FK references the new integer table

- GIVEN a `CanonicalVoucher` with `tipo_cbte = 1` (Factura A) is upserted into `vouchers_canonical`
- WHEN the row is inserted
- THEN the FK constraint against `afip_tipo_map(codigo)` succeeds without needing any translation step
- AND querying the row back returns `tipo_cbte = 1`, matching what the normalizer produced — no lossy round-trip through a different code

### RF-15: Upsert normalized rows into vouchers_canonical by composite key, per file_source

Every job that stages and normalizes rows MUST also upsert each successfully-normalized `CanonicalVoucher` into `vouchers_canonical`, keyed by `(tenant_id, file_source, cuit_emisor, tipo_cbte, punto_venta, numero)`. A re-upload of the same voucher (same composite key, same file_source) within the same or a later período MUST update the existing row (latest wins for `importe_total`/`fecha_emision`), not create a duplicate.

#### Scenario: First-time ARCA voucher lands as pendiente

- GIVEN a período `P1` receives an ARCA file with a voucher not previously seen for this tenant
- WHEN the job's normalization step runs
- THEN a new `vouchers_canonical` row is created with `estado = 'pendiente'`, `file_source = 'arca'`, `periodo_alta_id = P1`

#### Scenario: Re-uploading the same ARCA voucher within the same open período updates, not duplicates

- GIVEN período `P1` already has a `vouchers_canonical` row for CUIT `X`/tipo `1`/PV `1`/número `100` with `importe_total_ars = 1000`
- WHEN a corrected file is uploaded again in the same open período with the same voucher now showing `importe_total_ars = 1050`
- THEN the existing row is updated to `1050` (no second row is created)
- AND `idx_vouchers_tenant_key_unique` (a real unique index, not just app-layer dedupe) is what prevents the duplicate

#### Scenario: A voucher already estado='conciliado' is never overwritten by a later re-upload

- GIVEN a voucher's `vouchers_canonical` row has `estado = 'conciliado'` (from a previous período's close)
- WHEN a file uploaded in a new período contains a row with the same composite key
- THEN the upsert MUST NOT change its `estado`, `periodo_cierre_id`, or `importe_total_ars` — a conciliado voucher is immutable (RF-17 in `matching-periodico.spec.md` is what actually flags this situation as `posible_duplicado_en_sistema` rather than silently updating it)

## Open Questions Carried Into This Spec

- Whether shared-types' `AFIP_TIPOS_CADENCIAL`/`AFIP_TIPO_LABELS` gets fully replaced by the integer scheme, or a second catalogue is added alongside it — left to the implementing task, since `seed.ts`/`seed-runner.ts` and their existing tests depend on the current shape.
