# Dashboard Principal Specification

**Change**: dashboard-principal
**Link**: openspec/proposal/dashboard-principal.md
**Design**: openspec/designs/dashboard-principal/architecture.md
**Author**: SDD Executor
**Date**: 2026-08-23
**Status**: Draft — Phase A (Spec)

## Purpose

Replace the post-login linear screen flow with a three-section dashboard rendered after the (unchanged) tenant UUID entry: **A) Período en curso** (all simultaneously-open períodos + crear/reabrir/eliminar), **B) Histórico** (closed períodos → their frozen report), **C) Pendientes ARCA** (totals + SVG bar chart + histórico viewer access). Purely a rewiring of existing endpoints/components behind one entry screen — no backend endpoint is modified by this capability.

## Requirements

### RF-24: Dashboard shell replaces the linear flow after tenant entry

After `PeriodoSelector` yields a `tenantId`, the system MUST render a three-section Dashboard through a single-route `view` state machine (`dashboard | circuit | report | pendientes-historico`). The UUID paste step MUST remain exactly as today. Sections A+B MUST be fed by ONE existing `GET /api/periodos?tenant_id=` call (partitioned client-side by `estado`); Section C by ONE existing `GET tenants/:id/pendientes-historico` call. No API endpoint is modified by this capability.

#### Scenario: Tenant selection lands on the dashboard

- GIVEN a valid login and a pasted tenant UUID
- WHEN the tenant is selected
- THEN the Dashboard renders with sections A, B, and C
- AND everything before the dashboard (UUID step) behaves exactly as before

#### Scenario: Opening a período round-trips through the existing circuit

- GIVEN the dashboard lists open períodos
- WHEN the user opens one ("Abrir")
- THEN the app renders that período's existing circuit/report JSX verbatim
- AND navigating back remounts the Dashboard with a fresh `listPeriodos` fetch

#### Scenario: Pendientes histórico viewer is an overlay swap

- GIVEN section C is rendered
- WHEN the user clicks "Ver histórico completo"
- THEN `PendientesHistoricoViewer` renders as a view swap without leaving the dashboard route

### RF-25: Section A — Período en curso lists ALL simultaneously-open períodos

Section A MUST list every `abierto` período of the tenant ordered by `mes` DESC — the schema allows multiple simultaneously-open períodos and the UI MUST never assume just one. "Crear nuevo" MUST lead into the existing create-período → upload → matching circuit (no new creation flow). A tenant with zero períodos MUST see the empty state.

#### Scenario: Two simultaneously-open períodos are both listed

- GIVEN tenant T1 has open períodos for `2026-07` and `2026-08`
- WHEN the dashboard loads
- THEN both appear in section A, `2026-08` first (mes DESC)

#### Scenario: Empty períodos state

- GIVEN tenant T1 has no períodos
- WHEN the dashboard loads
- THEN section A shows the empty copy ("Este tenant todavía no tiene períodos")

#### Scenario: Crear nuevo reuses the existing circuit

- GIVEN section A is rendered
- WHEN the user triggers "Crear nuevo"
- THEN the existing create → upload → matching circuit opens unchanged

### RF-26: Section B — Histórico opens each closed período's frozen report

Section B MUST list `cerrado` períodos; each MUST offer opening its frozen `periodo_resultados` snapshot in the existing `PeriodoReportViewer`.

#### Scenario: Closed período opens its frozen report

- GIVEN T1 has one `cerrado` período P1 with a frozen snapshot
- WHEN the user clicks its "Ver reporte"
- THEN `PeriodoReportViewer` renders P1's frozen report

#### Scenario: Empty histórico state

- GIVEN T1 has no `cerrado` períodos
- WHEN the dashboard loads
- THEN section B shows its empty state (not an error)

### RF-27: Section C — Pendientes ARCA totals + SVG chart from a single fetch

Section C MUST render a totals card (`count_pendientes` and Σ `importe_total`) and a bar chart built from ONE `GET tenants/:id/pendientes-historico` response, bucketing rows by `fecha.slice(0,7)` (last 12 months). The chart MUST be hand-rolled inline SVG (zero new dependencies) with native `<title>` tooltips per bar. The viewer opened from here keeps pre-alta exclusions visible (`excluidos_previos_a_alta` bucket is never hidden).

#### Scenario: Totals and month buckets derive from the one fetch

- GIVEN the histórico response holds 5 pendientes across `2026-06` and `2026-07` totalling $10,000
- WHEN section C renders
- THEN the totals card shows 5 / $10,000 and two bars labelled by month bucket

#### Scenario: No pendientes

- GIVEN the histórico response has `count_pendientes = 0`
- WHEN section C renders
- THEN it shows the "Sin pendientes ARCA" empty copy with no bars

#### Scenario: Bar tooltip is native

- GIVEN a rendered bar for month bucket `2026-07`
- WHEN its DOM is inspected
- THEN it contains a `<title>` describing the month bucket

### RF-28: Role-gated actions — cliente read-only everywhere

The cliente role MUST see NO crear/reabrir/eliminar affordances anywhere (keeping the existing "solo lectura" copy on open períodos). "Reabrir" MUST be visible/enabled for admin and colaborador; "Eliminar" for admin only. Destructive actions (reabrir, eliminar) MUST require explicit confirmation via a confirmation dialog before any request fires. The server enforces these rules regardless of what the UI renders.

#### Scenario: Cliente sees a read-only dashboard

- GIVEN a cliente session WITH access to T1
- WHEN the dashboard renders
- THEN no crear/reabrir/eliminar control exists and open períodos show "solo lectura"

#### Scenario: Colaborador gets reabrir but not eliminar

- GIVEN a colaborador session
- WHEN sections render
- THEN "Reabrir" appears on closed períodos but "Eliminar" does not; an admin session sees both

#### Scenario: Confirmation dialog gates destructive requests

- GIVEN an admin clicks "Eliminar"
- WHEN the confirmation dialog has not been accepted
- THEN no `DELETE` request is sent; it fires only after confirmation

### RF-29: Independent per-section loading and error states

Each section MUST show its own loading indicator while fetching and, on failure, its own error banner with retry — one section's failure MUST NOT block the others from rendering.

#### Scenario: One fetch failing doesn't blank the dashboard

- GIVEN the `listPeriodos` call rejects
- WHEN the dashboard loads
- THEN sections A and B show an error banner with retry while section C still renders from its own fetch

#### Scenario: Loading indicators are per-section

- GIVEN slow responses
- WHEN the dashboard loads
- THEN each section shows its own spinner until its own data arrives

## Traceability

| Req | Source |
|-----|--------|
| RF-24 | Proposal Scope (Dashboard shell); Design AD-6, Component Diagram |
| RF-25 | Proposal Scope §A, Decision on multiple open períodos; Design AD-6 |
| RF-26 | Proposal Scope §B; Design Component Diagram |
| RF-27 | Proposal Scope §C, Decisions 4 (SVG, zero deps); Design AD-7 |
| RF-28 | Proposal Decision 3; Design AD-8 + Roles map |
| RF-29 | Proposal Scope "Empty/loading/error states"; Design Data paragraph |
