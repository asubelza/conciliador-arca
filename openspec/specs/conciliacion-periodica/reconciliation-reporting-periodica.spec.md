# Reconciliation Reporting Periódica Specification

**Change**: conciliacion-periodica
**Link**: openspec/proposal/conciliacion-periodica.md
**Author**: Claude
**Date**: 2026-08-22
**Status**: Draft — Phase A (Spec)
**Modifies**: `openspec/specs/mvp-carga-comprobantes/reconciliation-reporting.spec.md` (RF-10/RF-11's CSV/XLSX export mechanics and audit logging stay; this spec replaces the 4-sheet/5-category report structure with the client's 3-section structure)

## Purpose

Replace the current 4-sheet report (Matched / Unmatched ARCA / Unmatched Contabilidad / Errors) with the client's 3-section structure — Conciliados OK, Discrepancias y Alertas, Pendientes en ARCA — scoped to a período rather than a single job.

## Requirements

### RF-22: GET /api/periodos/:id/report returns the 3-section structure

The system MUST generate a report for a período with exactly three business sections plus the pre-existing technical `errors` category (rows that failed normalization — not shown as a 4th business section, same as today's treatment):

1. **Conciliados OK** — vouchers matched cleanly (or `con_divergencia`, see RF-23) in this período, once conciliado.
2. **Discrepancias y Alertas** — union of `no_existe_en_arca`, `con_divergencia`, `posible_duplicado_en_sistema`, each row tagged with which of the three it is.
3. **Pendientes en ARCA** — ARCA-side vouchers still `pendiente` as of this período, each row carrying `antiguedad_meses` (RF-19).

#### Scenario: A closed período's report reflects its frozen snapshot

- GIVEN período `P1` is `cerrado`
- WHEN `GET /api/periodos/P1/report?format=json` is called
- THEN the three sections reflect exactly what was true at close time (RF-20's snapshot), not a live re-computation

#### Scenario: An open período's report is a live view

- GIVEN período `P1` is `abierto` and has had two uploads so far
- WHEN `GET /api/periodos/P1/report?format=json` is called
- THEN it reflects the latest matching run's classification, ready to review before deciding to close

### RF-23: con_divergencia rows are visible in both Discrepancias and, once resolved, Conciliados

A `con_divergencia` match MUST appear in the "Discrepancias y Alertas" section while its período is open (so the accountant can review the amount difference before closing). If the período closes with that match still standing (the accountant chose to accept the divergence), the voucher's final `vouchers_canonical.estado` still becomes `conciliado` per RF-20 — but the closed período's frozen report snapshot MUST still show it flagged as having had a divergence, not silently folded into a plain "Conciliados OK" row indistinguishable from an exact match.

#### Scenario: A closed período's report distinguishes an accepted divergence from an exact match

- GIVEN a `con_divergencia` match with a `$3.00` difference was present when período `P1` closed
- WHEN `P1`'s report is generated after closing
- THEN the row appears in "Conciliados OK" (its voucher is now `estado = 'conciliado'`) AND retains a `divergencia_ars: 3.00` field
- AND the report/UI can visually distinguish it from a zero-difference exact match

## Open Questions Carried Into This Spec

- Export formats: this spec assumes CSV/XLSX/JSON stay as today (RF-10/RF-11 mechanics unchanged), just re-sectioned. Confirm no new format is needed.
