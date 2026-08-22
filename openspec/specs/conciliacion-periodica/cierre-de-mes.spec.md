# Cierre de Mes Specification

**Change**: conciliacion-periodica
**Link**: openspec/proposal/conciliacion-periodica.md
**Author**: Claude
**Date**: 2026-08-22
**Status**: Draft — Phase A (Spec)

## Purpose

Let the accountant explicitly close a período's reconciliation, permanently persisting each touched voucher's final state, rolling unmatched ARCA vouchers forward as pendiente stock for future períodos, and freezing an immutable snapshot of the período's results for audit — per the client's functional spec section 4 ("Funcionalidad Cierre de Mes").

## Requirements

### RF-20: Cerrar Conciliación del Mes persists final states and rolls pendiente stock forward

`POST /api/periodos/:id/cerrar` MUST, within a single transaction: (1) set `estado = 'cerrado'` on the período, recording `cerrado_at`/`cerrado_por`; (2) for every voucher matched (clean or `con_divergencia`) in this período's latest matching run, set its `vouchers_canonical.estado = 'conciliado'` and `periodo_cierre_id` to this período; (3) leave every ARCA-side voucher still `pendiente` untouched (already correctly `pendiente`, already carrying its original `periodo_alta_id` — "rollover" is achieved by these rows simply remaining queryable as pendiente stock in RF-16's historical pool for whichever período runs next, not by copying/moving rows); (4) snapshot the período's final `reconciliation_results` as immutable — same append-only guarantee `audit_trail` already has (`REVOKE UPDATE, DELETE`).

#### Scenario: Closing a período conciliates its matched vouchers

- GIVEN período `P1` is `abierto` and its latest matching run found 10 clean matches and 2 `con_divergencia` matches
- WHEN `POST /api/periodos/P1/cerrar` is called
- THEN all 12 vouchers' `vouchers_canonical` rows (both ARCA and Sistema side where applicable) become `estado = 'conciliado'`, `periodo_cierre_id = P1`
- AND `P1.estado` becomes `cerrado`

#### Scenario: Closing a período leaves unmatched ARCA vouchers pendiente for the future

- GIVEN período `P1` has 5 ARCA vouchers that found no Sistema match in its latest run
- WHEN `P1` is closed
- THEN those 5 vouchers remain `estado = 'pendiente'`, `periodo_alta_id = P1`
- AND a later período `P2`'s matching run (RF-16, step 3) can find them in the historical pendiente pool

#### Scenario: Closed períodos are immutable

- GIVEN período `P1` is `cerrado`
- WHEN any attempt is made to modify `P1`'s `reconciliation_results` rows directly (UPDATE/DELETE)
- THEN it fails with `permission denied`, same mechanism as `audit_trail`'s existing append-only guarantee (`REVOKE UPDATE, DELETE ... FROM app_role`)

#### Scenario: Closing an already-closed período is rejected

- GIVEN período `P1.estado = 'cerrado'`
- WHEN `POST /api/periodos/P1/cerrar` is called again
- THEN it is rejected with `409 Conflict` — closing is a one-way transition (per proposal.md's open question #1, this spec assumes no reopen path)

### RF-21: Cerrar Conciliación del Mes snapshots the tolerance used

The período's `tolerancia_ars` column MUST be populated at close time from the tenant's current `tolerancia_redondeo_ars` setting, so a later change to the tenant's tolerance never retroactively changes what a historical closed período's classification meant.

#### Scenario: Changing tenant tolerance after closing doesn't rewrite history

- GIVEN período `P1` was closed while the tenant's tolerance was `0.99`, and `P1.tolerancia_ars` was snapshotted as `0.99`
- WHEN the tenant later changes their tolerance to `2.00`
- THEN `P1.tolerancia_ars` still reads `0.99` — the historical record of what rule was applied doesn't change
