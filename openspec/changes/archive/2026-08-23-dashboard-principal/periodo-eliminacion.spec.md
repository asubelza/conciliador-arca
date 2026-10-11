# Período Eliminación Specification

**Change**: dashboard-principal
**Link**: openspec/proposal/dashboard-principal.md
**Design**: openspec/designs/dashboard-principal/architecture.md
**Author**: SDD Executor
**Date**: 2026-08-23
**Status**: Draft — Phase A (Spec)

## Purpose

`DELETE /api/periodos/:id` — HYBRID guard (user-confirmed decision): physical delete ONLY when the período has zero associated vouchers and no frozen snapshot; otherwise a `409` whose plain-language message names the blockers. NO soft-delete column, NO partial-index migration. Single transaction, serialized against cierre/reopen and in-flight uploads by the same `FOR UPDATE` row lock plus Postgres FK key-share semantics.

## Requirements

### RF-35: Delete endpoint — admin only, additive route

The system MUST expose `DELETE /api/periodos/:id` to role `admin` only. Handler order MUST mirror `cerrar`: param validation → `assertRole(['admin'])` → `resolvePeriodoTenantId` + `assertTenantAccess` → domain call. Colaborador and cliente MUST get `403`; an unknown id MUST return `404 {error}`. Success returns `200 {deleted: true, periodo_id}`.

#### Scenario: Admin deletes an empty período

- GIVEN P1 has zero references (see RF-36) and the caller is admin with access
- WHEN `DELETE /api/periodos/P1`
- THEN the response is `200 {deleted: true, periodo_id}` and the row is gone

#### Scenario: Colaborador and cliente are rejected

- GIVEN a colaborador (or cliente) JWT WITH tenant access
- WHEN `DELETE /api/periodos/P1`
- THEN the response is `403 {error}` for both roles

#### Scenario: Unknown período

- GIVEN no período with the given id
- WHEN `DELETE /api/periodos/:id`
- THEN the response is `404 {error}`

### RF-36: Hybrid zero-reference guard with plain-language 409

Within ONE transaction taking `SELECT ... FOR UPDATE` on the periodos row, the system MUST count references: `c1 = COUNT(*) FROM vouchers_canonical WHERE periodo_alta_id=:id OR periodo_cierre_id=:id`, and `c2 = COUNT(*) FROM periodo_resultados WHERE periodo_id=:id`. If `c1 + c2 > 0`, it MUST ROLLBACK and return `409 {error}` naming both counts verbatim, house shape (`{ error }` string): "cannot delete período: {c1} comprobante(s) and {c2} frozen resultado row(s) reference it — only an empty período can be deleted". When both counts are 0, it MUST physically DELETE the periodos row — the FK graph guarantees no orphans; there is no soft-delete column.

#### Scenario: Período with alta-stamped vouchers is blocked

- GIVEN P1 received uploads (vouchers stamped `periodo_alta_id=P1`)
- WHEN admin calls DELETE
- THEN the response is `409` and the message names `{c1}` comprobantes and `{c2}` resultado rows

#### Scenario: Closed período with zero matches is still blocked by its snapshot

- GIVEN P1 is `cerrado` but its matching run matched nothing, leaving frozen `periodo_resultados` rows
- WHEN admin calls DELETE
- THEN the response is `409` via `c2 > 0` (catches closed-with-zero-matches)

#### Scenario: Truly empty período is physically deleted

- GIVEN P1 has no staging-derived voucher rows and no snapshot rows
- WHEN admin calls DELETE
- THEN the periodos row is physically removed (no tombstone column involved)

### RF-37: Concurrent-upload race resolves safely both ways (FK key-share)

The BullMQ worker upserts vouchers with `periodo_alta_id=:id` inside ONE tx; each INSERT takes a FK `FOR KEY SHARE` lock on the referenced periodos row. Therefore: if the worker commits first, delete's `FOR UPDATE` unblocks, sees counts > 0, and returns `409` with all data intact; if delete commits first, the worker's INSERT fails with an immediate FK violation and its WHOLE job tx rolls back together (staging + canonical + audit) — the job surfaces as failed, nothing half-written. No hot-path/worker code change is required or allowed by this spec.

#### Scenario: Upload wins the race

- GIVEN an upload tx inserts a voucher for P1 and commits while a DELETE waits
- WHEN the delete proceeds after commit
- THEN DELETE returns `409` and every uploaded row remains intact

#### Scenario: Delete wins the race

- GIVEN DELETE commits while an upload tx for P1 is mid-flight
- WHEN the worker's next statement touches vouchers_canonical
- THEN the INSERT fails on FK violation, the whole job tx rolls back as one unit, and zero orphan staging/canonical/audit rows remain

### RF-38: Deleted month becomes recreatable

Because deletion is physical, the freed `UNIQUE (tenant_id, mes)` slot MUST allow creating a new período for the same month afterwards.

#### Scenario: Recreate the same month after deleting

- GIVEN empty P1 for `2026-07` was successfully deleted
- WHEN `POST /api/periodos` is called for T1, mes `2026-07`
- THEN creation succeeds with `estado='abierto'`

## Traceability

| Req | Source |
|-----|--------|
| RF-35 | Proposal Decision 3 + Scope; Design Roles map, Delete sequence |
| RF-36 | Proposal Decision 1 (HYBRID); Design AD-2, AD-3, Delete sequence |
| RF-37 | Proposal Decision 1 context; Design "Why the row lock suffices" |
| RF-38 | Proposal Scope (UNIQUE stays intact); Design Delete sequence note |
