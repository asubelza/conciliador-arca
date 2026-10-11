# Design: dashboard-principal

**Proposal**: openspec/proposal/dashboard-principal.md
**Exploration**: openspec/explore/dashboard-principal.md

## Technical Approach

Two additive backend endpoints (`POST /api/periodos/:id/reabrir`, `DELETE /api/periodos/:id`) implemented as siblings of `periodo-cierre.ts` — same single-transaction + typed-failure pattern, no schema changes. Reopen is a **strict inverse of cierre**, scoped by `periodo_cierre_id` stamps so manual "resolver sin pareja" marks survive. Delete is **hybrid-C**: physical delete only when zero rows reference the período; otherwise 409 naming blockers. The frontend replaces the linear flow with a `Dashboard` shell rendered after tenant entry, wired through a `view` state machine in `page.tsx` that reuses every existing circuit component unchanged. Zero new dependencies; one tiny privileges migration (see AD-4).

## Architecture Decisions

| # | Decision | Choice | Alternatives | Rationale |
|---|----------|--------|--------------|-----------|
| AD-1 | Reopen scope | Undo ONLY cierre's stamped writes inside one tx | Recompute/rollback via inverse of matchPeriodo | Cierre's effects are all identifiable by `periodo_cierre_id`; exact inverse is provable, recompute is not |
| AD-2 | Delete guard locking | `SELECT ... FOR UPDATE` on the periodos row + 2 reference COUNTs in the same tx | Advisory locks; touching the upload hot path | Row lock serializes vs cierre/reopen (they take the same lock) AND vs in-flight uploads via Postgres FK `FOR KEY SHARE` semantics (see Data Flow) — zero changes to worker code |
| AD-3 | 409 body shape | Plain `{ error }` string embedding counts | Structured `{ blocked_by: {...} }` | House convention (`readErrorMessage` reads `body.error`); UI surfaces verbatim per proposal |
| AD-4 | Privileges migration | New `023_grant_app_role_delete_periodos.sql`: `GRANT DELETE ON periodos, periodo_resultados TO app_role` + update `app-role-grants.test.ts` expectations | Rely on superuser bypass | 017's invariant is "every grant mirrors an actual app statement"; reopen/delete issue DELETEs that are currently test-asserted DENIED. Additive privileges only — proposal's "no migrations" meant no schema change; this is a 2-line GRANT migration keeping least-privilege docs honest |
| AD-5 | Validators | Reuse existing `validatePeriodoIdParam`; NO new validators | New pure validators per proposal | Both new routes take only `:id` — there is nothing else to validate. Divergence from proposal noted deliberately |
| AD-6 | Dashboard navigation | Single-route `view` union in `page.tsx`; Dashboard owns período list/create/reopen/delete; PeriodoSelector slims to tenant-entry (+ admin config panel stays there) | Keep full PeriodoSelector + add "dashboard" button | Avoids two competing período lists; smallest diff to tested components; matches explore recommendation 1 |
| AD-7 | Chart | Hand-rolled SVG `<svg>` bars from one `getPendientesHistorico` call, grouped by `fecha.slice(0,7)`, last 12 months, `<title>` tooltips | recharts / canvas lib | Proposal decision 4; inline-SVG precedent exists in `icons.tsx` |
| AD-8 | Confirm dialogs | New reusable `ConfirmDialog` styled after `CoincidenciaModal`; adopted for reabrir/eliminar | Replace ALL `window.confirm/prompt` now | Reopen/delete are the destructive actions this change adds; migrating `PeriodoReportViewer`'s legacy prompts touches stable tested code — optional cleanup task, not required |

## Sequence Diagrams

### Reabrir (exact inverse of cierre — one tx)

```
Controller POST :id/reabrir
  validatePeriodoIdParam ──▶ assertRole(['admin','colaborador']) ──▶ resolvePeriodoTenantId+assertTenantAccess
        │
        ▼
reabrirPeriodo(pool, id):
  BEGIN
  SELECT id,tenant_id,estado FROM periodos WHERE id=$1 FOR UPDATE
    ├─ 0 rows            ─▶ ROLLBACK {NOT_FOUND,404}
    └─ estado='abierto'  ─▶ ROLLBACK {ALREADY_ABIERTO,409}   ← mirrors ALREADY_CERRADO; race-safe
  UPDATE vouchers_canonical SET estado='pendiente', periodo_cierre_id=NULL
         WHERE periodo_cierre_id=$1 AND estado='conciliado'      -- stamp filter EXCLUDES manual
         RETURNING 1  → n_reabiertos                             -- resolver marks (no stamp)
  DELETE FROM periodo_resultados WHERE periodo_id=$1  → m_eliminados   -- snapshot regenerates at next cierre
  UPDATE periodos SET estado='abierto', tolerancia_ars=NULL,
         cerrado_at=NULL, cerrado_por=NULL WHERE id=$1           -- mirrors cierre's exact column set
  logAuditEvent(client,'reopen',entity:'periodo',details:{n,m})  -- in-tx: rollback removes it too
  COMMIT  → {periodo(abierto,nulls), counts:{vouchers_reabiertos:n, resultados_eliminados:m}}
```

Survive untouched (verified against code): manual resolver conciliations (set `'conciliado'` WITHOUT `periodo_cierre_id` — `WHERE ... AND estado='conciliado'` + stamp NULL check never un-resolves them), `fuzzy_match_confirmations` (re-read by next `matchPeriodo`), `feedback_loop` (composite_key-scoped), job-scoped `reconciliation_results`, ARCA rollover stock (`pendiente_en_arca` keeps its original `periodo_alta_id`). Idempotency/conflict: reopen twice concurrently serializes on the row lock; second sees `estado='abierto'` → 409.

### Eliminar (hybrid guard — one tx)

```
Controller DELETE :id
  validatePeriodoIdParam ──▶ assertRole(['admin']) ──▶ resolvePeriodoTenantId+assertTenantAccess
        │
        ▼
eliminarPeriodo(pool, id):
  BEGIN
  SELECT id,tenant_id,estado FROM periodos WHERE id=$1 FOR UPDATE     -- serialization point (AD-2)
    └─ 0 rows ─▶ ROLLBACK {NOT_FOUND,404}
  c1 = COUNT(*) FROM vouchers_canonical WHERE periodo_alta_id=$1 OR periodo_cierre_id=$1
  c2 = COUNT(*) FROM periodo_resultados WHERE periodo_id=$1          -- catches closed-with-zero-matches
  IF c1+c2 > 0 ─▶ ROLLBACK {BLOCKED,409,
      error:"cannot delete período: {c1} comprobante(s) and {c2} frozen resultado row(s) reference it —
             only an empty período can be deleted"}
  DELETE FROM periodos WHERE id=$1        -- FK graph guarantees no orphans when counts are 0
  logAuditEvent(client,'delete',entity:'periodo')
  COMMIT → 200 {deleted:true, periodo_id}
```

**Why the row lock suffices against concurrent uploads**: the BullMQ worker upserts vouchers with `periodo_alta_id=$pid` inside ONE tx; each such INSERT takes a `FOR KEY SHARE` lock on the referenced periodos row. If the worker inserts first, delete's `FOR UPDATE` blocks until commit, then counts > 0 → 409. If delete commits first, the worker's INSERT hits an immediate FK violation and its WHOLE tx rolls back (staging+results+audit together — already single-tx) → job surfaces as failed, nothing half-written. No hot-path changes needed.

Roles map (existing guards, no new machinery): reopen = `['admin','colaborador']` (mirrors cerrar/create); delete = `['admin']` (sole precedent `PUT tenants/:id/config`); cliente read-only server-side regardless of UI. Handler order mirrors `cerrar`: param validation → `assertRole` → cheap `resolvePeriodoTenantId` + `assertTenantAccess` → domain call.

## Component Diagram (frontend)

```
LoginForm ──▶ PeriodoSelector(tenant entry + admin TenantConfigPanel)
                  │ onSelected(tenantId)
                  ▼
       page.tsx  view state machine:
       'dashboard' ⇄ 'periodo'(active Periodo)      showPendientesHistorico overlay-swap in dashboard
          │                │                              │
          ▼                ▼                              ▼
     Dashboard.tsx    EXISTING circuit JSX (unchanged)  PendientesHistoricoViewer
      ├─ Section A Período en curso: open períodos list (ALL simultaneously-open, mes DESC)
      │    [Abrir→view:'periodo'] [Crear nuevo] [Eliminar(admin, ConfirmDialog)]
      ├─ Section B Histórico: cerrado list [Ver reporte→view:'periodo'] [Reabrir(admin+colab)]
      └─ Section C Pendientes ARCA: totals card + PendientesArcaChart(SVG)
           [Ver histórico completo→overlay swap]
```

Data: Sections A+B from ONE existing `GET /api/periodos?tenant_id=` call (partition by `estado`); Section C from ONE existing `GET tenants/:id/pendientes-historico` call. No endpoint modified — purely additive deltas elsewhere. `view='periodo'` renders today's circuit block verbatim (UploadForm→StatusPoller→UploadSummary/ReportViewer + PeriodoReportViewer toggle, incl. CoincidenciaModal inside PeriodoReportViewer); switching back remounts Dashboard → fresh `listPeriodos`. States: per-section loading spinner (`SpinnerIcon`), error banner + retry, empty copies ("Este tenant todavía no tiene períodos" / "Sin pendientes ARCA"); cliente variant hides crear/reabrir/eliminar (server enforces anyway) and keeps the existing "solo lectura" copy for open períodos.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/api/src/periodos/periodo-reapertura.ts` | Create | `reabrirPeriodo()` — tx above; typed failures `NOT_FOUND \| ALREADY_ABIERTO` mirroring `PeriodoCierreFailure` |
| `packages/api/src/periodos/periodo-eliminacion.ts` | Create | `eliminarPeriodo()` — guard tx above; failures `NOT_FOUND \| BLOCKED(409)` |
| `packages/api/src/periodos/periodos.controller.ts` | Modify | 2 routes + imports; order per AD-mapping above |
| `packages/api/prisma/migrations/023_grant_app_role_delete_periodos.sql` | Create | 2 GRANTs + comment citing calling statements (AD-4) |
| `packages/api/src/app-role-grants.test.ts` | Modify | Flip periodos/periodo_resultados "cannot DELETE" assertions to allowed |
| `packages/shared-types/src/index.ts` | Modify | Additive `PeriodoReabrirResponse`, `PeriodoDeleteResponse` (below) |
| `packages/web/app/page.tsx` | Modify | `view` union; mount `<Dashboard>`; back-navigation resets circuit state |
| `packages/web/components/Dashboard.tsx` | Create | Shell + sections A/B/C, action handlers, role gating |
| `packages/web/components/PendientesArcaChart.tsx` | Create | ~80-line SVG bar chart, month buckets, `<title>` tooltips, indigo/dark tokens |
| `packages/web/components/ConfirmDialog.tsx` | Create | Reusable confirm modal (CoincidenciaModal styling precedent) |
| `packages/web/components/PeriodoSelector.tsx` | Modify | Slims to tenant entry; período list/create move into Dashboard; TenantConfigPanel stays |
| `packages/web/lib/api.ts` | Modify | `reabrirPeriodo()`, `eliminarPeriodo()` fetchers using shared-types responses |
| Tests (new/extend) | Create/Modify | `periodo-reapertura.test.ts`, `periodo-eliminacion.test.ts`, extend `periodos.controller.test.ts`; web: `Dashboard.test.tsx`, `PendientesArcaChart.test.tsx`, update `page.test.tsx`, `PeriodoSelector.test.tsx` |

## Interfaces / Contracts (additive)

```ts
// packages/shared-types/src/index.ts
export interface PeriodoReabrirResponse {
  periodo: { id: string; tenant_id: string; mes: string; estado: 'abierto';
             tolerancia_ars: null; cerrado_at: null; cerrado_por: null };
  counts: { vouchers_reabiertos: number; resultados_eliminados: number };
}
export interface PeriodoDeleteResponse { deleted: true; periodo_id: string }
// Failures stay house-shape: { error: string } with 400/403/404/409.
```

Existing contracts untouched: `GET /api/periodos`, `GET tenants/:id/pendientes-historico`, cierre, report, coincidencias, resolver, marks.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit/integration API | Reopen: close→reopen returns stamped vouchers to `pendiente`+NULL stamps, empties `periodo_resultados`, resets columns, audit `'reopen'` row exists; manual-resolver voucher stays conciliado; close→reopen→re-close reproduces equivalent snapshot; 409 abierto; 404 missing | Supertest + real PG following `periodo-cierre.test.ts` patterns |
| Integration API | Delete: empty→200 row gone; with alta/cierre vouchers→409 message names counts; closed→409; unknown→404; colaborador/cliente JWT→403 | Same harness |
| Privileges | app_role CAN now DELETE both tables under `SET ROLE app_role` | Extend `app-role-grants.test.ts` |
| Unit web | Chart month-bucketing + totals math (pure functions exported from `PendientesArcaChart.tsx`) | Jest |
| RTL | Dashboard sections/partition/role gating/loading/error/empty; ConfirmDialog gates eliminar; page nav selector↔dashboard↔circuit; reopen/delete refresh lists | Mocked `lib/api` |
| E2E smoke | Optional Playwright pass over the 3-section flow | Existing setup |

## Migration / Rollout

Migration 023 is additive privileges (no data change); rollback = revert backend slice (routes disappear, grants harmless). Runtime effects of reopen/delete on real data are irreversible BY DESIGN — mitigated by audit trail forensics. Frontend revert restores linear flow; reused components untouched. Size still exceeds the 400-line budget (~800–1,050) → chained PR split recommended for sdd-tasks (slice 1 backend, slice 2 frontend).

## Open Questions

- [ ] Backend error strings remain English (house pattern; UI shows them verbatim today). Translate to Spanish later? Product call, not blocking.
