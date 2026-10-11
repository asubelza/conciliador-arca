# Cierre de Mes Delta — dashboard-principal

**Change**: dashboard-principal
**Modifies**: openspec/specs/conciliacion-periodica/cierre-de-mes.spec.md
**Link**: openspec/proposal/dashboard-principal.md
**Design**: openspec/designs/dashboard-principal/architecture.md
**Author**: SDD Executor
**Date**: 2026-08-23
**Status**: Draft — Phase A (Spec)

Delta spec: one MODIFIED requirement (RF-20). RF-21 is unchanged by this change.

## MODIFIED Requirements

### RF-20: Cerrar Conciliación del Mes persists final states and rolls pendiente stock forward

`POST /api/periodos/:id/cerrar` MUST, within a single transaction: (1) set `estado = 'cerrado'` on the período, recording `cerrado_at`/`cerrado_por`; (2) for every voucher matched (clean or `con_divergencia`) in this período's latest matching run, set its `vouchers_canonical.estado = 'conciliado'` and `periodo_cierre_id` to this período; (3) leave every ARCA-side voucher still `pendiente` untouched (already correctly `pendiente`, already carrying its original `periodo_alta_id` — "rollover" is achieved by these rows simply remaining queryable as pendiente stock in RF-16's historical pool for whichever período runs next, not by copying/moving rows); (4) snapshot the período's final `reconciliation_results` as immutable — same append-only guarantee `audit_trail` already has (`REVOKE UPDATE, DELETE`).

The snapshot's append-only guarantee now carries exactly ONE explicit exception (user-approved decision, this change): the audited reopen action (`POST /api/periodos/:id/reabrir`) DELETES the entire frozen `periodo_resultados` snapshot, which regenerates at the next cierre. At DB level, UPDATE stays denied to `app_role` permanently; DELETE is granted solely so the audited reopen path can empty the snapshot — no other endpoint or code path MAY issue a `DELETE FROM periodo_resultados`.

(Previously: the snapshot was absolutely immutable with no reopen path; closing was described as a one-way transition.)

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

#### Scenario: Closed períodos are immutable except through the audited reopen path

- GIVEN período `P1` is `cerrado`
- WHEN any attempt is made to modify `P1`'s frozen snapshot rows directly (`UPDATE`)
- THEN it fails with `permission denied` — the `REVOKE UPDATE` guarantee is unchanged
- AND snapshot rows MAY be deleted only inside the audited reopen transaction (`action='reopen'`); any other deletion path violates this spec

#### Scenario: Closing an already-closed período is rejected

- GIVEN período `P1.estado = 'cerrado'`
- WHEN `POST /api/periodos/P1/cerrar` is called again
- THEN it is rejected with `409 Conflict` — closing itself remains one-way per call; undoing a cierre happens exclusively through the separate, audited reopen action

## Traceability

| Change | Source |
|--------|--------|
| Append-only exception | Proposal Decision 2 + Risks ("accepted" doctrine break); Design AD-4 |
| Immutable-scenario edit | Design AD-4 (DELETE grant) + Reopen sequence step 2 |
| Already-closed-scenario edit | Proposal Modified Capabilities (`cierre-de-mes`); Design AD-1 |
