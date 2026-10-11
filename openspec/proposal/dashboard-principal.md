# Proposal: dashboard-principal

## Intent
After login + tenant UUID paste (UUID step stays unchanged), replace the linear screen flow with a DASHBOARD of 3 sections: A) Período en curso (list open períodos + crear/reabrir/eliminar), B) Histórico (closed períodos → their frozen report), C) Pendientes ARCA (totals + SVG chart + histórico viewer access). Reabrir and Eliminar are NEW backend features; everything else rewires existing components behind one entry screen.

## User-Confirmed Decisions
1. **DELETE = HYBRID**: physical delete ONLY when the período has zero associated vouchers (staging rows, reconciliations, marks); otherwise reject with a clear conflict error. NO soft-delete column, NO partial-index migration.
2. **REOPEN = undo exactly what cierre wrote**, keyed on `periodo_cierre_id` stamps; "resolver sin pareja" manual conciliations SURVIVE reopen; the frozen `periodo_resultados` snapshot IS DELETED on reopen and regenerated at next cierre (accepted exception to append-only doctrine).
3. **Roles**: reopen = admin+colaborador; delete = admin only; cliente keeps read-only everywhere.
4. **Chart** = hand-rolled SVG bars, zero new dependencies.
5. Estimated size will likely exceed the 400-line review budget → probable chained PR split (backend slice / frontend slice); final split left to sdd-tasks.

## Scope

### In Scope
- `Dashboard.tsx` shell (single-route view-state extension of `page.tsx`) rendered after PeriodoSelector yields tenantId
- Section A: list of ALL simultaneously-open períodos (schema allows multiple); Crear nuevo período → existing upload→matching circuit; opening a período → its normal circuit/report
- `POST /api/periodos/:id/reabrir` — transactional exact inverse of cierre, audited
- `DELETE /api/periodos/:id` — guarded physical delete (zero-reference check, else 409)
- Section B: closed-períodos list; each opens `PeriodoReportViewer`
- Section C: totals summary + month-grouped SVG bar chart fed by ONE `GET tenants/:id/pendientes-historico` call; button opens `PendientesHistoricoViewer` in a separate view
- Role-gated UI per decision 3; `lib/api.ts` fetchers; shared-types for both endpoints

### Out of Scope
- Replacing UUID paste UX; auth/JWT changes
- New matching logic, tolerance, or report-format changes
- Soft-delete column / partial unique index migration (explicitly rejected)
- App Router multi-page routing
- Enforcing a single open período per tenant (product decision deferred)

## Capabilities

### New Capabilities
- `dashboard-principal`: post-login 3-section dashboard shell; multi-open-período handling; pendientes ARCA summary + SVG chart
- `periodo-reapertura`: reopen semantics — exact inverse of cierre via `periodo_cierre_id` stamps; what survives vs resets; role gate
- `periodo-eliminacion`: hybrid delete guard — zero-voucher physical delete vs 409 conflict

### Modified Capabilities
- `periodos`: spec explicitly assumed NO reopen action exists ("add one later if the client confirms") — reopen/delete extend período lifecycle requirements
- `cierre-de-mes`: "closed períodos are immutable" gains an explicit audited exception — reopen DELETES the frozen snapshot and it regenerates at next cierre

## Approach

**Reabrir** (`POST :id/reabrir`, admin+colaborador): sibling of `periodo-cierre.ts` — same tx + typed-failure pattern. `SELECT ... FOR UPDATE`; 409 `ALREADY_ABIERTO` mirrors `ALREADY_CERRADO`. One tx: (1) `UPDATE vouchers_canonical SET estado='pendiente', periodo_cierre_id=NULL WHERE periodo_cierre_id=$pid AND estado='conciliado'` — the stamp filter excludes manual resolver conciliations (they carry no `periodo_cierre_id`); (2) `DELETE FROM periodo_resultados WHERE periodo_id=$pid`; (3) reset `estado='abierto', tolerancia_ars=NULL, cerrado_at=NULL, cerrado_por=NULL` (mirrors cierre's column set); (4) append audit `'reopen'`. KEPT: fuzzy_match_confirmations, feedback_loop marks, reconciliation_results, manual conciliations.

**Eliminar** (`DELETE :id`, admin): one tx — count references via `periodo_alta_id`, `periodo_cierre_id`, `periodo_resultados.periodo_id` (plus fuzzy/reconciliation voucher refs); if ZERO → physical delete of the período row; else 409 whose error names the blocking references in plain language. No migration; `UNIQUE(tenant_id, mes)` stays intact.

**Dashboard** (web): `page.tsx` gains a `view` union (`dashboard | circuit | report | ...`); tenant selection renders `<Dashboard tenantId role>`. Section A lists open períodos (never assumes one); B filters `cerrado`; C computes totals (count, Σ `importe_total`) and month buckets (`fecha.slice(0,7)`) from the existing response shape → inline SVG bars with Tailwind dark-mode styling and native `<title>` tooltips.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/api/src/periodos/periodo-reapertura.ts` | New | Reopen domain logic (mirror of `periodo-cierre.ts`) |
| `packages/api/src/periodos/periodo-eliminacion.ts` | New | Guarded hard delete |
| `packages/api/src/periodos/periodos.controller.ts` | Modified | 2 new routes; `resolvePeriodoTenantId` + `assertRole` wiring |
| `packages/api/src/periodos/periodos-validation.ts` | Modified | Pure validators per house convention |
| `packages/shared-types/src/` | Modified | Types for both endpoints |
| `packages/web/app/page.tsx` | Modified | View-state insertion point |
| `packages/web/components/Dashboard.tsx` + children | New | Sections A/B/C cards + SVG bar-chart component |
| `packages/web/lib/api.ts` | Modified | `reabrirPeriodo` / `eliminarPeriodo` fetchers |

No Prisma migrations. No new npm dependencies.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Reopen misses an effect cierre wrote → silent drift | Med | Undo strictly scoped to stamped columns; integration test replays cierre→reopen→re-cierre and compares snapshots |
| Hybrid delete confuses users ("why can't I delete?") | Med | 409 body names blockers in plain language; UI surfaces it verbatim |
| Append-only doctrine break (snapshot deletion) | Low — accepted | Explicit spec delta + audit `'reopen'` event records the deletion |
| Review budget blowout | High | Chained PRs (see estimate); sdd-tasks decides final split |

## Size Estimate (review-budget forecast)

Backend ≈ 450–550 lines (logic + validators + controller + Supertest); frontend ≈ 350–500 (Dashboard + chart + fetchers + RTL). Total ≈ 800–1,050 changed lines → **exceeds the 400-line budget**: chained PRs recommended (slice 1 backend + tests; slice 2 frontend consuming them). Final slicing deferred to sdd-tasks.

## Rollback Plan
- Both endpoints are ADDITIVE routes: reverting the backend slice removes them; no migration to unwind (hybrid choice deliberately avoided schema change).
- Reopen/delete effects on real data are irreversible BY DESIGN — mitigated by `audit_trail` forensics and DB-backup restore as last resort.
- Frontend revert: git revert of the dashboard slice restores the linear flow; reused components are untouched, so blast radius = `page.tsx` + new files.

## Dependencies
None external — reuses `pendientes-historico` endpoint, `PeriodoReportViewer`, `PendientesHistoricoViewer`, `AFIP_TIPO_LABELS`.

## Success Criteria
- [ ] Cierre → Reabrir → re-Cierre reproduces an equivalent snapshot; previously stamped vouchers return to `pendiente`
- [ ] Manual "resolver sin pareja" conciliations survive reopen untouched
- [ ] DELETE succeeds only on a zero-reference período; referenced ones → 409 naming blockers
- [ ] cliente sees no reopen/delete affordances; API rejects them regardless of UI
- [ ] Dashboard correctly renders MULTIPLE simultaneously-open períodos
- [ ] Zero new dependencies; chart renders from a single `pendientes-historico` fetch
