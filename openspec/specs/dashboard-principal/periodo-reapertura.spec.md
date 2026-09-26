# Período Reapertura Specification

**Change**: dashboard-principal
**Link**: openspec/proposal/dashboard-principal.md
**Design**: openspec/designs/dashboard-principal/architecture.md
**Author**: SDD Executor
**Date**: 2026-08-23
**Status**: Draft — Phase A (Spec)

## Purpose

`POST /api/periodos/:id/reabrir` — undo exactly what cierre wrote, inside one transaction, keyed on `periodo_cierre_id` stamps so manual "resolver sin pareja" conciliations survive. The frozen `periodo_resultados` snapshot is deleted and regenerates at the next cierre (user-approved exception to the append-only doctrine, see cierre-de-mes delta). Sibling of `periodo-cierre.ts`: same single-tx + typed-failure pattern.

## Requirements

### RF-30: Reopen endpoint, role gate, and resolution order

The system MUST expose `POST /api/periodos/:id/reabrir` to roles `admin` and `colaborador` only. Handler order MUST mirror `cerrar`: param validation → `assertRole(['admin','colaborador'])` → `resolvePeriodoTenantId` + `assertTenantAccess` → domain call. A cliente JWT MUST be rejected with `403` even when it has tenant access; an unknown período id MUST return `404 {error}`.

#### Scenario: Colaborador reopens a closed período

- GIVEN P1 is `cerrado` and the caller is a colaborador WITH access to its tenant
- WHEN `POST /api/periodos/P1/reabrir`
- THEN the response is `200` with the RF-33 body

#### Scenario: Cliente is rejected regardless of UI

- GIVEN a cliente JWT WITH access to P1's tenant
- WHEN `POST /api/periodos/P1/reabrir`
- THEN the response is `403 {error}`

#### Scenario: Unknown período

- GIVEN no período with the given id
- WHEN `POST /api/periodos/:id/reabrir`
- THEN the response is `404 {error}`

### RF-31: Single transaction, row-locked, race-safe ALREADY_ABIERTO

Reopen MUST run in ONE transaction that first takes `SELECT id, tenant_id, estado FROM periodos WHERE id=$1 FOR UPDATE`. If `estado = 'abierto'`, it MUST ROLLBACK and fail typed `{code:'ALREADY_ABIERTO', status:409, error}` — mirroring cierre's `ALREADY_CERRADO`. Because both cierre, reopen (and delete) serialize on this same row lock, concurrent duplicate reopens are race-safe. Expected failures are typed `NOT_FOUND | ALREADY_ABIERTO`, never thrown.

#### Scenario: Already-open período is rejected

- GIVEN P1.`estado = 'abierto'`
- WHEN `POST /api/periodos/P1/reabrir`
- THEN the response is `409` with code `ALREADY_ABIERTO`

#### Scenario: Concurrent double reopen serializes on the row lock

- GIVEN two simultaneous `reabrir` calls for cerrado P1
- WHEN both transactions run
- THEN exactly one commits with `200` and the other blocks, then sees `estado='abierto'` and gets `409`

### RF-32: Undo strictly scoped to cierre's stamps — manual marks survive

The voucher undo MUST be exactly one statement scoped by the cierre stamp: `UPDATE vouchers_canonical SET estado='pendiente', periodo_cierre_id=NULL WHERE periodo_cierre_id=:id AND estado='conciliado'`. Manual "resolver sin pareja" conciliations carry NO stamp (`estado='conciliado'`, `periodo_cierre_id IS NULL`) and therefore MUST survive reopen untouched. The following MUST NOT be modified by reopen: `fuzzy_match_confirmations`, `feedback_loop` marks, job-scoped `reconciliation_results`, and ARCA rollover stock (a `pendiente` row keeps its original `periodo_alta_id`).

#### Scenario: Stamped vouchers return to pendiente

- GIVEN P1 was closed conciliating 12 vouchers stamped `periodo_cierre_id=P1`
- WHEN P1 is reopened
- THEN all 12 rows read `estado='pendiente'`, `periodo_cierre_id=NULL`
- AND `counts.vouchers_reabiertos = 12`

#### Scenario: Manual resolver-sin-pareja mark survives

- GIVEN an ARCA voucher was set `conciliado` via the resolver endpoint (no `periodo_cierre_id`)
- WHEN its período is reopened
- THEN that voucher remains `conciliado`, untouched

#### Scenario: ARCA rollover stock is untouched

- GIVEN 5 ARCA vouchers remain `pendiente` with original `periodo_alta_id=P1`
- WHEN P1 is reopened
- THEN those 5 stay `pendiente` with the same `periodo_alta_id`

### RF-33: Snapshot deletion + column reset mirror cierre's write set; response shape

Within the same transaction, reopen MUST (1) `DELETE FROM periodo_resultados WHERE periodo_id=:id` (count → `counts.resultados_eliminados`; the snapshot regenerates at the next cierre), and (2) reset exactly cierre's column set: `estado='abierto', tolerancia_ars=NULL, cerrado_at=NULL, cerrado_por=NULL`. Success MUST return:

```ts
{ periodo: { id, tenant_id, mes, estado: 'abierto',
             tolerancia_ars: null, cerrado_at: null, cerrado_por: null },
  counts: { vouchers_reabiertos: number, resultados_eliminados: number } }
```

#### Scenario: Snapshot emptied and columns reset

- GIVEN closed P1 with 30 snapshot rows and `tolerancia_ars=0.99`
- WHEN P1 is reopened
- THEN `periodo_resultados` has zero rows for P1 and the período reads `abierto` with all three columns NULL
- AND `counts.resultados_eliminados = 30`

#### Scenario: Close → reopen → re-close reproduces an equivalent snapshot

- GIVEN P1 was closed, reopened, and its data unchanged
- WHEN P1 is closed again
- THEN the previously stamped vouchers are re-conciliated with the new stamp and the regenerated snapshot is equivalent to the original

### RF-34: Audited in-transaction 'reopen' event

Reopen MUST append an `audit_trail` row with `action='reopen'`, `entity='periodo'`, `details={vouchers_reabiertos:n, resultados_eliminados:m}` INSIDE the transaction — so a rollback removes the audit row too, and only committed reopens are audited.

#### Scenario: Successful reopen is audited with counts

- GIVEN a successful reopen of P1
- WHEN the tx commits
- THEN `audit_trail` contains one `action='reopen'` row for P1 carrying both counts

#### Scenario: Failed reopen leaves no audit row

- GIVEN a reopen attempt that fails (e.g. `ALREADY_ABIERTO`)
- WHEN the tx rolls back
- THEN no `reopen` audit row exists for that attempt

## Traceability

| Req | Source |
|-----|--------|
| RF-30 | Proposal Decision 3 + Approach; Design Roles map, handler order |
| RF-31 | Proposal Approach (tx + typed failure); Design AD-2, Reopen sequence |
| RF-32 | Proposal Decision 2; Design AD-1 + "Survive untouched" list |
| RF-33 | Proposal Decision 2; Design AD-4, sequence steps 2–3, Contracts |
| RF-34 | Proposal Risks (audit forensics); Design sequence step 4 |
