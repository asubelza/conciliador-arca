# Matching Periódico Specification

**Change**: conciliacion-periodica
**Link**: openspec/proposal/conciliacion-periodica.md
**Author**: Claude
**Date**: 2026-08-22
**Status**: Draft — Phase A (Spec)
**Modifies**: `openspec/specs/mvp-carga-comprobantes/reconciliation-matching.spec.md` (RF-08/RF-09 stay true for a single job's own two lists; this spec adds what happens across a período's persistent stock)

## Purpose

Replace the single-pass, two-ephemeral-lists match with the 3-step algorithm the client's functional spec requires: exclude what's already `conciliado`, match against the current período's own ARCA load, then fall back to the persistent `pendiente` stock from earlier períodos. Add amount-tolerance comparison and duplicate detection on top of the exact composite-key match RF-08 already established.

## Requirements

### RF-16: 3-step match order — exclude conciliado, match corriente, match histórico

For a given período's matching run, the system MUST build the ARCA candidate pool as: (this período's own ARCA-side `vouchers_canonical` rows) UNION (other períodos' ARCA-side rows with `estado = 'pendiente'`) — and MUST NEVER include any row with `estado = 'conciliado'` in that pool, regardless of período. Each Sistema-side row MUST first be probed against the current período's own ARCA rows before falling back to the historical pendiente pool.

#### Scenario: Match found in the current período (Match Corriente) never falls through to history

- GIVEN período `P2`'s ARCA upload contains voucher `V` (CUIT/tipo/PV/número match a Sistema row also uploaded in `P2`)
- AND an unrelated pendiente voucher with the SAME composite key also happens to exist from período `P1` (edge case, e.g. a correction)
- WHEN `P2`'s matching runs
- THEN the Sistema row matches against `P2`'s own corriente ARCA row, not the `P1` historical one
- AND the `P1` historical row is left untouched (still pendiente, not consumed)

#### Scenario: Match found only in historical pendiente stock (Match Histórico)

- GIVEN período `P1`'s ARCA upload included voucher `V`, still `pendiente` after `P1` closed (no match found then)
- AND período `P2` (a later, currently open período) receives a Sistema-side upload containing `V`
- WHEN `P2`'s matching runs
- THEN `V` is found via the historical pendiente pool (step 3), not step 2
- AND is classified as a match, ready to be finalized `conciliado` when `P2` closes

#### Scenario: A conciliado voucher is never returned as a match candidate

- GIVEN voucher `V`'s `vouchers_canonical` row has `estado = 'conciliado'` (closed in a prior período)
- WHEN a later período's Sistema upload contains `V` again
- THEN the match search (steps 2 and 3) finds nothing for `V` — the conciliado pool is excluded by construction
- AND `V` is instead routed to RF-17's duplicate check, not silently matched again

### RF-17: Detect posible_duplicado_en_sistema

When a Sistema-side row finds no match in the pendiente pool (RF-16), the system MUST check whether its composite key exists in `vouchers_canonical` with `estado = 'conciliado'` (any período). If so, it MUST be classified `posible_duplicado_en_sistema` instead of `no_existe_en_arca`.

#### Scenario: Re-entering an already-conciliado voucher is flagged as a duplicate, not a plain discrepancy

- GIVEN voucher `V` is `estado = 'conciliado'`, closed in período `P1`
- WHEN período `P2`'s Sistema upload contains `V` again (company re-entered the same invoice by mistake)
- THEN `V` is classified `posible_duplicado_en_sistema`, referencing the período it was originally conciliado in
- AND is NOT classified `no_existe_en_arca` (which would be misleading — it does exist in ARCA, just already closed out)

#### Scenario: A genuinely new Sistema voucher with no ARCA history at all is a plain discrepancy

- GIVEN voucher `W`'s composite key has never appeared in `vouchers_canonical` for this tenant, in any estado
- WHEN it's uploaded on the Sistema side and no match is found
- THEN it is classified `no_existe_en_arca` (the existing plain "not found" case), not `posible_duplicado_en_sistema`

### RF-18: Amount tolerance and con_divergencia, configurable per tenant

For every match found (RF-16), the system MUST compare `importe_total_ars` (and, where present, netos/IVA) between the ARCA and Sistema sides. If the absolute difference exceeds the tenant's configured `tolerancia_redondeo_ars` (default `0.99`), the match MUST be classified `con_divergencia` instead of a clean match; a difference at or under the tolerance is still a clean match.

#### Scenario: Difference within tolerance is a clean match

- GIVEN tenant `T1` has `tolerancia_redondeo_ars = 0.99`
- AND a matched pair has ARCA `importe_total_ars = 1000.00` and Sistema `999.50`
- WHEN the divergence check runs
- THEN the pair is classified as a clean match (difference `0.50` ≤ tolerance)

#### Scenario: Difference exceeding tolerance is con_divergencia

- GIVEN the same tenant and tolerance
- AND a matched pair has ARCA `1000.00` and Sistema `995.00` (difference `5.00`)
- WHEN the divergence check runs
- THEN the pair is classified `con_divergencia`, carrying both amounts and the delta for the report

#### Scenario: Two tenants apply their own tolerance in the same run

- GIVEN tenant `T1` has `tolerancia_redondeo_ars = 0.99` and tenant `T2` has `5.00`
- AND both have a matched pair with a `2.00` difference
- WHEN each tenant's matching runs independently
- THEN `T1`'s pair is `con_divergencia` (2.00 > 0.99) and `T2`'s pair is a clean match (2.00 ≤ 5.00)

### RF-19: Pendiente en ARCA with antigüedad

Any ARCA-side `vouchers_canonical` row still `pendiente` after a período's matching pass (not consumed by any Sistema-side match) MUST be reportable with its `antiguedad_meses` — the number of calendar months between its `periodo_alta_id` and the currently viewed período.

#### Scenario: A 3-month-old pendiente voucher reports the correct antigüedad

- GIVEN voucher `V` was first loaded (ARCA side) in período `2026-01`
- AND is still `pendiente` when período `2026-04` is being viewed/reported
- WHEN the "Pendientes en ARCA" section of the report is generated for `2026-04`
- THEN `V` appears with `antiguedad_meses = 3`

## Open Questions Carried Into This Spec

- Whether tolerance applies only to `importe_total_ars` or independently to Neto/IVA sub-amounts too (proposal's architecture.md open question) — this spec assumes `importe_total_ars` only until confirmed otherwise.
