# Períodos Lifecycle Delta — dashboard-principal

**Change**: dashboard-principal
**Modifies**: openspec/specs/conciliacion-periodica/periodos.spec.md
**Link**: openspec/proposal/dashboard-principal.md
**Design**: openspec/designs/dashboard-principal/architecture.md
**Author**: SDD Executor
**Date**: 2026-08-23
**Status**: Draft — Phase A (Spec)

Delta spec: ADDED requirements only. RF-12 and RF-13 of the base spec are unchanged by this change; full reopen/delete semantics live in this change's `periodo-reapertura.spec.md` and `periodo-eliminacion.spec.md`.

## ADDED Requirements

### RF-39: Additive reopen/delete routes extend the período lifecycle

The períodos API MUST gain two additive routes — `POST /api/periodos/:id/reabrir` and `DELETE /api/periodos/:id` — whose complete semantics, roles, and failure contracts are defined in `periodo-reapertura.spec.md` (RF-30…RF-34) and `periodo-eliminacion.spec.md` (RF-35…RF-38) of this change. This resolves the open question carried in the base spec ("whether a closed período can ever be reopened"): reopening now exists as an explicit, audited, role-gated action. Every existing RF-12/RF-13 contract (create, list, multi-upload while abierto, cerrado rejects uploads) MUST remain unchanged — a reabiert período is simply `abierto` again and obeys those rules as usual.

#### Scenario: A closed período exposes both lifecycle routes

- GIVEN P1 is `cerrado`
- WHEN its lifecycle is inspected
- THEN both routes are available with exactly the sibling-spec semantics (reopen: admin+colaborador; delete: admin)

#### Scenario: Existing períodos contracts are untouched

- GIVEN the current test suite for create/list/uploads/cerrar
- WHEN the two new routes are added
- THEN every pre-existing test passes unmodified — no request/response shape of an existing endpoint changes

### RF-40: Least-privilege migration grants exactly DELETE on periodos + periodo_resultados

A new additive privileges migration (`023_grant_app_role_delete_periodos.sql`) MUST `GRANT DELETE ON periodos, periodo_resultados TO app_role`, each GRANT commented with the calling statement that needs it (reopen's snapshot DELETE; delete's row DELETE). The `app-role-grants.test.ts` least-privilege assertions MUST flip ONLY those two tables' "cannot DELETE" expectations to allowed — every other denial in that suite (all DELETEs on other tables, UPDATE on periodo_resultados/reconciliation_results/vouchers_staging, any access to afip_tipo_map) MUST keep passing unchanged. This preserves migration 017's invariant that every grant mirrors an actual application statement.

#### Scenario: app_role can run the reopen path's snapshot delete

- GIVEN `SET ROLE app_role`
- WHEN `DELETE FROM periodo_resultados WHERE periodo_id = $1` executes
- THEN it succeeds — this is the audited reopen path's own statement

#### Scenario: Every other privilege denial still holds

- GIVEN `SET ROLE app_role`
- WHEN `DELETE FROM reconciliation_results` or `UPDATE periodo_resultados SET ...` is attempted
- THEN both fail with `permission denied`, same as before this change

## Traceability

| Req | Source |
|-----|--------|
| RF-39 | Proposal Modified Capabilities (`periodos`) + Scope endpoints; Design Technical Approach |
| RF-40 | Design AD-4; openspec/progress/app-role-grants.md (017 invariant) |
