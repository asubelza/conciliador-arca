# Exploration: Dashboard principal post-login (3 secciones) + Reabrir/Eliminar período

## Problem Space

Replace the current linear flow (`PeriodoSelector` → upload/matching circuit) with a **Dashboard** shown after login + tenant UUID selection, with 3 sections:

- **A) Período en curso**: Crear nuevo período (→ existing upload/matching circuit), **Reabrir período** (NEW backend), **Eliminar período** (NEW backend); opening the período leads to its normal circuit/report.
- **B) Histórico**: closed períodos list; each opens its frozen report view.
- **C) Pendientes ARCA**: totals summary (+ chart if viable) and access to the histórico de pendientes ARCA (reuse `PendientesHistoricoViewer`).

Sections A's reopen/delete are backend features first; this exploration is deliberately backend-heavy per the orchestrator brief.

## Current State

### Backend — períodos domain (what "cerrar" actually does)

`cerrarPeriodo()` (`packages/api/src/periodos/periodo-cierre.ts`) runs in ONE transaction:

1. `SELECT ... FOR UPDATE` on the `periodos` row → 404 if missing, **409 if already `cerrado`** (race-safe).
2. Runs `matchPeriodo()` (matching engine) against the tx client.
3. Stamps matched vouchers (`conciliado_ok` / `con_divergencia`): `vouchers_canonical.estado='conciliado', periodo_cierre_id=$pid`.
4. Inserts the frozen 6-classification snapshot into `periodo_resultados` (incl. `posible_coincidencia` + `similarity_reason`, migration 021).
5. Flips the row: `estado='cerrado'`, snapshots applied tolerance into `tolerancia_ars`, sets `cerrado_at`, `cerrado_por`; writes an `audit_trail 'close'` event.

**Untouched by cierre** (deliberate rollover, RF-20 scenario 2): ARCA rows left `pendiente_en_arca` keep their original `periodo_alta_id` — that is what makes them visible to later períodos' historical matching pool.

**Soft-delete precedent: NONE.** No table has a `deleted_at`. The codebase culture is append-only (`audit_trail`, `periodo_resultados` even has `REVOKE UPDATE, DELETE FROM app_role` in migration 016 — currently dormant since sessions connect as superuser, but it documents intent).

### FK graph (real SQL constraints, from migrations — Prisma schema is docs-only, no relations declared)

Into `periodos(id)`:
- `periodo_resultados.periodo_id` (016)
- `vouchers_canonical.periodo_alta_id` (015)
- `vouchers_canonical.periodo_cierre_id` (015)

Into `vouchers_canonical(id)` (matters only for hard delete):
- `fuzzy_match_confirmations.sistema_voucher_id` + `.arca_voucher_id` (020)
- `reconciliation_results.voucher_canonical_id` (005)

Consequence: a naive `DELETE FROM periodos` **fails at DB level** once any voucher/resultados reference it.

### Auth model

- JWT claims → `req.user {id, role, email, display_name}` via `AuthGuard`; role is a plain string on the token (`users.role`: `admin | colaborador | cliente`).
- Convention (`role-check.ts` module doc): **every GET open to all 3 roles** (subject to `assertTenantAccess`); **every write = `['admin','colaborador']`**. Single admin-only precedent: `PUT tenants/:id/config` (`assertRole(req.user!, ['admin'])`).
- Today: create período AND cerrar = `['admin','colaborador']`.
- `cliente` + `user_tenant_access` gates tenant visibility (`tenant-access.ts`). Frontend already hides write UI from cliente ("Tu usuario es de solo lectura").

### Validation conventions (`periodos-validation.ts` + controller style)

- Hand-rolled pure validators returning typed failures `{error, status}` (or `{ok:false, failure}` for complex bodies). No class-validator/DTO classes anywhere.
- Handler order: validate body → `assertRole` → resolve tenant (`resolvePeriodoTenantId`) → `assertTenantAccess` → work → `logAuditEvent`.
- Domain flows return `{code:'NOT_FOUND'|..., status, error}` mapped to `HttpException` in controller (see `periodo-cierre.ts`, `pendientes-historico.ts`).
- Postgres error mapping: unique violation `23505` → 409.

### Pendientes ARCA data shape

`GET /api/tenants/:id/pendientes-historico` (`tenants/pendientes-historico.ts`) returns:

```ts
{ tenant: {id,name,created_at},
  pendientes: Row[],            // fecha >= tenant alta date
  count_pendientes,
  excluidos_previos_a_alta: Row[], count_excluidos_previos_a_alta }
// Row: id, cuit_emisor, tipo_cbte(int), punto_venta, numero,
//      importe_total(float), iva, fecha('YYYY-MM-DD'), file_source,
//      estado, periodo_alta_id, antiguedad_meses
```

Everything needed for totals + chart aggregations is already in one response: total count & `sum(importe_total)`, group-by month (`fecha.slice(0,7)`), group-by tipo (`AFIP_TIPO_LABELS` in shared-types maps int code → label), antigüedad buckets. No new endpoint strictly required.

### Frontend state machine (`packages/web/app/page.tsx`, single route)

`LoginForm` (no user) → `PeriodoSelector.onSelected(tenantId, periodo)` → linear circuit: abierto = UploadForm → StatusPoller → UploadSummary (+ReportViewer toggle) with PeriodoReportViewer toggle; cerrado = PeriodoReportViewer swapped with PendientesHistoricoViewer. Destructive actions today use `window.confirm`/`prompt`. Zero shared UI components; deps are exactly next/react/react-dom + Tailwind dark mode (no chart/UI libs). `PeriodoReportViewer(periodoId, onClosed)` already returns the refreshed período after cierre.

## Affected Areas

Backend:
- `packages/api/src/periodos/periodo-cierre.ts` — sibling file for reopen/delete logic (same tx + typed-failure pattern).
- `packages/api/src/periodos/periodos.controller.ts` — new routes `POST :id/reabrir`, `DELETE :id` (or POST alias); reuse `resolvePeriodoTenantId` + validator conventions.
- `packages/api/src/periodos/periodos-validation.ts` — new pure validators.
- `packages/api/prisma/migrations/0XX_*.sql` — only if soft delete chosen (add `deleted_at` + partial unique index).
- `packages/api/prisma/schema.prisma` — docs-only mirror update.

Frontend:
- `packages/web/app/page.tsx` — top-level view state gains a dashboard view; PeriodoSelector output (tenantId) feeds it.
- NEW `components/Dashboard.tsx` (+ small children: section cards, SVG bar chart) — the only substantial new frontend piece.
- `components/PendientesHistoricoViewer.tsx`, `PeriodoReportViewer.tsx`, `UploadForm/StatusPoller/UploadSummary/ReportViewer` — reused unchanged inside dashboard views.
- `lib/api.ts` — fetchers for reabrir/eliminar (+ types).

## Approaches

### Reopen semantics

**What gets reset vs kept** — the invariant that makes reopen safe is: *undo exactly what cierre wrote, nothing else*.

1. **Reset**: `UPDATE vouchers_canonical SET estado='pendiente', periodo_cierre_id=NULL WHERE periodo_cierre_id=$pid AND estado='conciliado'` — reverses ONLY stamps this close made.
2. **Reset**: `DELETE FROM periodo_resultados WHERE periodo_id=$pid` — mandatory: re-closing re-runs `matchPeriodo()` and would duplicate snapshot rows otherwise. (Breaks the nominal append-only doctrine of 016 — acceptable because reopen is an explicit privileged action, audited.)
3. **Reset**: `UPDATE periodos SET estado='abierto', tolerancia_ars=NULL, cerrado_at=NULL, cerrado_por=NULL WHERE id=$pid` (mirrors cierre's exact column set).
4. **Kept**: manual `pendientes-arca-resolver` conciliations (they set `estado='conciliado'` WITHOUT `periodo_cierre_id` — the WHERE above excludes them; controller doc says they are permanent tenant-level decisions, "deja de aparecer en cualquier período futuro").
5. **Kept**: `fuzzy_match_confirmations` (pair-level decisions, still valid after reopen; matchPeriodo reads them again on next report), `feedback_loop` marks (composite_key-scoped, no período FK), job history (`reconciliation_results` is job-scoped), audit trail (append new `'reopen'` event).

Guard: 409 if período already `abierto` (mirror `ALREADY_CERRADO`); `FOR UPDATE` lock same as cierre; roles `['admin','colaborador']` (same severity as cerrar itself).

### Delete strategy

| Approach | Pros | Cons | Complexity |
|----------|------|------|------------|
| A. Soft delete (`deleted_at` column; lists/reports filter or reject) | Zero data loss; reversible; no FK surgery; matches append-only culture; audit-friendly | Needs migration; UNIQUE(tenant_id, mes) blocks recreating the same month after soft-delete unless replaced by a partial unique index `WHERE deleted_at IS NULL`; "eliminado" períodos still occupy DB | Low-Med |
| B. Hard cascade delete in one tx (delete stamped vouchers → fuzzy refs → resultados → período) | Truly frees the month slot; simple mental model | **Destroys persistent stock beyond the período**: ARCA pendientes first uploaded in that período feed FUTURE months' matching pool (RF-16 rollover) — deleting them silently corrupts later reconciliations; must also chase refs into fuzzy_match_confirmations + reconciliation_results; irreversible | High risk |
| C. Hybrid: hard delete ONLY when zero vouchers reference the período (created-but-never-used), else refuse 409 pointing to soft delete | Eliminates the data-loss class entirely while still allowing cleanup of mistakes; no migration needed | Two behaviors to document/test; doesn't free the month slot for used períodos | Low |

### Section C chart

| Approach | Pros | Cons | Complexity |
|----------|------|------|------------|
| Hand-rolled SVG bar chart (counts/sums by month from existing pendientes-historico fetch) | Zero deps; consistent with inline-SVG `icons.tsx` precedent; full Tailwind dark-mode control; ~80 lines | No tooltips/animations for free (can add `<title>` + hover states) | Low |
| Add recharts (~heavy dep) | Rich charts instantly | Breaks the project's zero-UI-lib posture; bundle cost; another dependency to maintain | Low effort, high footprint |

### Dashboard shell

1. **Single-route view-state extension** (recommended): page.tsx gains `view: 'dashboard' | 'circuit' | 'report' | ...`; after `PeriodoSelector` yields tenantId, render Dashboard instead of jumping into a período. Existing components drop in as-is.
   - Pros: matches current architecture (no router dep, single route), smallest diff to existing tested components.
   - Cons: page.tsx grows — mitigate by moving section rendering into `Dashboard.tsx`.
   - Effort: Medium.
2. App Router multi-page (`/dashboard`, `/periodo/[id]`, ...) — proper URLs but introduces routing/session-sharing plumbing the app never had; touches every component's navigation assumptions. Effort: High. Not recommended for this change.

## Recommendation

- **Reopen** as specified above (undo-cierre-exactly, keep manual resolutions + fuzzy decisions), `POST :id/reabrir`, roles `['admin','colaborador']`, full audit event. This is safe and precise BECAUSE cierre stamps every effect with `periodo_cierre_id`.
- **Delete**: recommend **A (soft delete)** as primary, optionally combined with **C** if the user wants mistaken-empty-períodos truly gone. **Hard cascade (B) must be rejected** — it deletes ARCA stock that belongs to future períodos. Requires USER sign-off (see Risks). If soft: migration adds `deleted_at TIMESTAMPTZ NULL` and replaces `UNIQUE(tenant_id, mes)` with a partial unique index so the month can be recreated after elimination; GET periodos filters `deleted_at IS NULL`; detail/cerrar/reopen on a deleted período → 404/409.
- **Roles**: reopen/delete follow existing gates — both hidden from cliente in UI; delete recommended `['admin']` (matches the sole destructive-config precedent `PUT :id/config`), reopen `['admin','colaborador']`.
- **Section C**: reuse the existing pendientes-historico endpoint for totals + hand-rolled SVG bar chart grouped by month (labels via shared-types `AFIP_TIPO_LABELS` when grouping by tipo). Button swaps in `PendientesHistoricoViewer` (already exists, takes just `tenantId`).
- **Frontend**: Approach 1 (single-route view state). New `Dashboard.tsx` receives `tenantId` + user role; PeriodoSelector stays as the tenant-entry step feeding it. Note: schema allows MULTIPLE simultaneously-open períodos for a tenant (UNIQUE is per-month only) — Section A should render the open list, not assume one.

## Risks

- **DELETE DATA LOSS (needs USER sign-off)**: choosing hard cascade deletes vouchers that still feed future períodos' matching pool — silent corruption of ongoing reconciliation. Recommend soft delete (or hybrid C); user must approve strategy explicitly.
- **REOPEN SEMANTICS (needs USER sign-off)**: confirm (a) manual "resolver sin pareja" conciliations SURVIVE reopen (recommended: yes — permanent decision), (b) deleting the frozen `periodo_resultados` snapshot on reopen is acceptable despite its documented append-only doctrine.
- UNIQUE(tenant_id, mes): without the partial-index migration, soft-deleting a período permanently blocks recreating that month.
- Multiple open períodos per tenant are possible today — "Período en curso" UX must handle a list (or the product must decide to enforce a single open período — separate question).
- Size: backend (2 endpoints + migration + tests) + dashboard frontend will exceed the 400-line review budget → chained PRs (backend slice, then frontend slice) recommended downstream.
- RLS policies are dormant (superuser bypass) — not introduced by this change, but reopen/delete write paths inherit that caveat.

## Ready for Proposal

Yes — pending two USER decisions before spec freeze: (1) delete strategy (soft vs hybrid-C vs hard), (2) reopen treatment of manual resolver conciliations + snapshot deletion confirmation.
