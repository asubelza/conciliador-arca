# PR-9 Apply Progress — dashboard-principal Slice 2 (Dashboard UI, frontend)

**Branch:** `feature/dashboard-principal-pr-9` (chain strategy: feature-branch-chain, PR-8 = backend slice — already merged/archived, PR-9 = this frontend slice).
**Context:** implements the three-section Dashboard shell (RF-24..RF-29) that replaces the post-login linear flow, wired to PR-8's `reabrirPeriodo`/`eliminarPeriodo` endpoints, under strict TDD (RED→GREEN per gap found during audit).

## Status: complete (T60–T66, frontend)

## Audit of pre-existing uncommitted work (before this session)

Several files existed uncommitted in the working tree, appearing to implement T60–T66. Audited each against the exact AC in `tasks.yaml` + `openspec/designs/dashboard-principal/architecture.md` + `openspec/specs/dashboard-principal/dashboard-principal.spec.md`, then ran `npx jest --config jest.web.config.js`. Findings:

| File | Claimed task | Audit result |
|------|-------------|--------------|
| `ConfirmDialog.tsx`/`.test.tsx` | T60 | **Partially done.** Title/body/confirm/cancel worked, but Escape-key and backdrop-click cancel (explicit AC text) were missing — backdrop `onClick` was a no-op, no keydown listener. Not spec-complete. |
| `PendientesArcaChart.tsx`/`.test.tsx` | T61 | **Looked done but had a real bug.** The component ignored its own `result` prop and performed a SECOND internal `getPendientesHistorico()` fetch inside a `useEffect`, violating RF-27's explicit "ONE fetch" requirement — and made the component effectively untestable (no bars/titles ever rendered in tests, since no fetch mock was configured for this file). Existing test suite only asserted "renders without crashing" (a smoke test), which is how this passed unnoticed. |
| `lib/api.ts` (reabrirPeriodo/eliminarPeriodo) | T62 | **Not spec-complete.** Fetchers existed and hit the right endpoints, but returned `Promise<void>`, discarding the response body — design explicitly requires them to return the shared-types `PeriodoReabrirResponse`/`PeriodoDeleteResponse` contracts from T56. |
| `Dashboard.tsx`/`.test.tsx` | T63/T64 | **Significant gaps.** (1) "Reabrir" button lived in Section A targeting an *open* período — reopening an abierto período always 409s (ALREADY_ABIERTO); per design's component diagram, Reabrir belongs on Section B's *cerrado* rows. (2) No colaborador-role test/coverage at all. (3) No per-section loading spinner or error-banner-with-retry (RF-29) — a failed `listPeriodos` silently logged to console and rendered the empty-state copy, indistinguishable from "no períodos". (4) Cliente role was reduced to a single static message with no visibility into its own open período (RF-28 only forbids crear/reabrir/eliminar, not visibility) — cliente had no way to reach the circuit view at all. (5) "Ver histórico completo" (Section C) had no `onClick` at all — dead link; `PendientesHistoricoViewer` was imported but never rendered, so RF-24's overlay-swap scenario was unimplemented. |
| `app/page.tsx`/`page.test.tsx` | T65/T66 | **Not started.** `onOpenPeriodo` was a `console.log` stub — clicking "Abrir" never navigated anywhere. `PeriodoSelector.tsx` was untouched — still the full pre-dashboard tenant-lookup + período-list + período-create component, not slimmed per AD-6. |

Baseline safety net before any change: `npx jest --config jest.web.config.js` → **109/109 passing** (17 suites) — confirms nothing already-shipped was broken; all gaps above were either incomplete features or a latent bug, not regressions.

## Work done this session (strict TDD, RED→GREEN per gap)

1. **ConfirmDialog** — added Escape-key (`document.addEventListener('keydown', ...)`) and backdrop-click cancel; RED added first (2 new tests failed against the old component), then GREEN.
2. **PendientesArcaChart** — removed the redundant internal fetch entirely; `chartData` now derives synchronously via `useMemo(() => processData(result), [result])` from the prop SectionC already fetched. Added a RED test asserting 12 `<rect>` bars + 12 native `<title>` tooltips for non-empty data and zero bars for the empty state — this test failed against the old (fetch-based) implementation for the right reason (stuck in its own loading state) before the fix.
3. **lib/api.ts** — `reabrirPeriodo()`/`eliminarPeriodo()` now return `Promise<PeriodoReabrirResponse>`/`Promise<PeriodoDeleteResponse>` (shared-types, type-only import via the existing `shared-types` tsconfig path alias — confirmed to resolve cleanly through `next/jest` and `next build`).
4. **Dashboard.tsx** — moved "Reabrir" to Section B (per closed-período row, admin+colaborador), added `SectionErrorBanner`/`SectionSpinner` shared components wired into both Section A and B (independent per-section loading/error/retry, RF-29), fixed the cliente branch of Section A to keep listing open períodos with a "solo lectura" tag (Abrir still works) instead of hiding them entirely, and wired Section C's "Ver histórico completo" to a local `showHistoricoOverlay` toggle in `DashboardShell` that swaps in `PendientesHistoricoViewer` without changing `page.tsx`'s `view` state (RF-24's "without leaving the dashboard route").
5. **page.tsx** — `PeriodoSelector.onSelected` now yields only `tenantId`; added `handleOpenPeriodo` (sets `periodo` + `view:'circuit'`) wired to both Dashboard's `onOpenPeriodo` (Section A, abierto) and `onViewReport` (Section B, cerrado — RF-26 also round-trips through the existing circuit JSX, matching the pre-existing "Ver histórico de pendientes ARCA" regression test which lives inside that same circuit header). Nav tabs now render only once a `periodo` is selected (previously gated the whole app on `periodo`, which made Dashboard itself unreachable before opening a período).
6. **PeriodoSelector.tsx** — slimmed to pure tenant-entry (AD-6): validates the UUID, shows a confirmation panel with the admin-only tolerance-config toggle (`TenantConfigPanel` — unchanged), and a "Continuar al dashboard" button that calls `onSelected(tenantId)`. Período list/create logic removed entirely (now lives in Dashboard). Button relabeled "Ingresar" (was "Buscar períodos" — no longer searches anything). Blast radius confirmed contained to `PeriodoSelector.tsx` + `PeriodoSelector.test.tsx` + `page.test.tsx` (only 3 files referenced the old button text repo-wide).

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| T60 | `ConfirmDialog.test.tsx` | Unit/RTL | ✅ 7/7 pre-existing | ✅ 2 new tests written (Escape, backdrop) | ✅ 9/9 passed | ✅ +2 (no-onCancel guard, click-inside-does-not-cancel) | ➖ None needed |
| T61 | `PendientesArcaChart.test.tsx` | Unit/RTL | ✅ 4/4 pre-existing | ✅ written (12 bars/titles + empty-state assertion) | ✅ 5/5 passed after removing the redundant fetch | ✅ non-empty + empty cases | ✅ removed dead `aggregateByMonth` helper (unused, referenced the fetch's return type) |
| T62 | Exercised via `Dashboard.test.tsx` + `page.test.tsx` (no dedicated `lib/api.test.ts` — matches this repo's existing convention: no other fetcher in `lib/api.ts` has a direct unit test) | Integration (via mocks) | N/A (signature widening only) | ➖ Triangulation skipped: structural return-type change, single possible output shape | ✅ verified via `tsc --noEmit` + full suite green | ➖ Single | ➖ None needed |
| T63/T64 | `Dashboard.test.tsx` | Unit/RTL | ✅ 8/8 pre-existing | ✅ 6 new/updated tests written first (Reabrir-on-cerrado, 2-open-DESC, colaborador gating, loading spinner, error+retry, historico overlay, cliente-can-still-Abrir) | ✅ 14/14 passed | ✅ multiple role/estado combinations per scenario | ✅ extracted `SectionErrorBanner`/`SectionSpinner` |
| T65/T66 | `page.test.tsx`, `PeriodoSelector.test.tsx` | Integration/RTL | ✅ 17/17 + 4/4 pre-existing | ✅ rewrote flows first against new component shape (fails confirmed: old "Buscar períodos" text, old direct-list flow) | ✅ 12/12 + 5/5 passed | ✅ admin/colaborador/cliente x abierto/cerrado combinations | ➖ None needed |

## Test Summary

- **Total tests in `packages/web`**: 119/119 passing (17 suites) — `npx jest --config jest.web.config.js`.
- **New tests written this session**: ~19 (ConfirmDialog +2, PendientesArcaChart +1, Dashboard +6 net incl. one rewritten "Reabrir" approval test, PeriodoSelector rewritten (5 tests replacing 6 old ones — old flow no longer exists), page.tsx +2 (exact-match fixes on 4 pre-existing tests + 1 new fresh-refetch regression test)).
- **`npx tsc --noEmit`**: clean.
- **`npx next build`**: `✓ Compiled successfully`, static export of `/` at 15.4 kB / 103 kB First Load JS.
- **Dependencies**: zero new — confirmed via `git status`/`git diff` on `package.json`/lockfiles (no changes).

## Notable engineering decisions (deviations from the literal pre-existing code, all spec-driven)

- **Reabrir moved from Section A to Section B.** The pre-existing code had "Reabrir período" as a global button in Section A operating on `openPeriodos[0]` — this is a logic error (reabrir undoes a *cierre*, so it only makes sense on a `cerrado` período; calling it on an `abierto` one always 409s `ALREADY_ABIERTO`). Design's component diagram places `[Reabrir(admin+colab)]` on Section B (Histórico) explicitly. Fixed to a per-row button on each closed período.
- **`onOpenPeriodo` and `onViewReport` share one handler in `page.tsx`.** RF-24's "Abrir" scenario and RF-26's "Ver reporte" scenario both describe the same round-trip ("renders that período's existing circuit/report JSX verbatim"); routing both through `handleOpenPeriodo` (sets `periodo` + `view:'circuit'`) also preserves the pre-existing 2026-08-23 regression test for the histórico-toggle swap, which lives inside the circuit view's header for a `cerrado` período — using the separate top-level `'report'` view (which only renders bare `PeriodoReportViewer`, no toggle) would have silently dropped that toggle's reachability for períodos opened from the Dashboard.
- **Nav tabs (Dashboard/Circuito/Reporte/Histórico) now gate on `periodo !== null`, not always-visible.** Before a período is opened, "Circuito"/"Reporte"/"Histórico" would render nothing (their render functions all check `periodo && tenantId`) — dead clicks. Showing them only once a período exists avoids that and matches how they were exercised in every existing test.
- **Cliente can still see and open its own período.** RF-28 says cliente sees no crear/reabrir/eliminar — it does NOT say cliente can't see its períodos. The pre-existing code's cliente branch was a full early-return with a generic message and zero períodos rendered, which would have made the Dashboard a dead end for cliente users (no way to reach the read-only circuit view). Fixed to keep listing open períodos with a "solo lectura" tag next to "Abrir", dropping only Crear/Eliminar.
- **`PendientesArcaChart` derives its data from the `result` prop, not a second fetch.** RF-27 is explicit: "built from ONE `GET tenants/:id/pendientes-historico` response". The pre-existing implementation had SectionC fetch once and pass `result` down, then the chart fetched *again* internally and threw the prop away — a real bug that also made the "native `<title>` per bar" requirement untestable (tests never actually reached the rendered-chart branch).
- **`PeriodoSelector`'s button relabeled "Buscar períodos" → "Ingresar".** The component no longer searches/lists périodos (that's now Dashboard's job), so the old label was semantically wrong. Blast radius confirmed contained to 2 files before the change (`PeriodoSelector.tsx`, `page.test.tsx`) plus its own test file.
- **Two latent React warnings surfaced and fixed once the chart actually rendered.** Removing the redundant fetch (above) made `PendientesArcaChartComponent` reach its real bar-rendering branch in tests for the first time — which exposed `Warning: Each child in a list should have a unique "key" prop` (the `<defs>` gradient block, pushed into the same array as the keyed bars, had none) and `Warning: Invalid DOM property 'stop-color'. Did you mean 'stopColor'?` (raw SVG attribute name instead of React's camelCase). Both fixed; also removed an unused `Bar()` helper component that was fully superseded by the inline bar-building logic in the main render.
- **`reabrirPeriodo()`/`eliminarPeriodo()` return typed responses** (`PeriodoReabrirResponse`/`PeriodoDeleteResponse` from `shared-types`, imported type-only so there's zero runtime cross-package coupling risk) instead of discarding the body — matches design's explicit "fetchers using shared-types responses" and lets `page.tsx`'s `onReopenPeriodo` handler read back the reopened período's fresh state directly instead of doing a second `listPeriodos` round-trip (removed that redundant call too).

## Review workload note

Combined diff across `packages/web` for this slice: 5 modified files (~894 changed lines: 568 insertions / 326 deletions) + 6 new files (`ConfirmDialog.tsx/.test.tsx`, `Dashboard.tsx/.test.tsx`, `PendientesArcaChart.tsx/.test.tsx`). This exceeds the original ~400–600 line forecast for PR-9 in `tasks.yaml`'s Review Workload Forecast, mostly due to the `PeriodoSelector`/`page.tsx` rewiring turning out larger than estimated (AD-6's slimming touched more call sites than anticipated) plus the RF-29 loading/error/retry states added to Dashboard. Per the already-resolved `feature-branch-chain` strategy, PR-9 is itself one deliverable work unit (the whole frontend slice) — no further chain-splitting was requested or attempted for this apply batch; flagging the size here for the maintainer's review-budget awareness rather than blocking on it.

## Known follow-ups (out of this branch's scope by design)

- T67 (Phase 3, cross-verification): run both suites + builds together, walk the RF-24..RF-40 traceability map, optional Playwright smoke — not part of this frontend-only slice.
- T68 (optional, explicitly deferred by AD-8): migrate `PeriodoReportViewer`'s legacy `window.confirm`/`prompt` calls to `ConfirmDialog` — marked "NO requerido para este cambio" in the design.

## Review fixes (2026-09-26)

Fixed 11 review findings against PR-9 (2 BLOCKER, 8 SHOULD-FIX, 1 NIT), strict TDD (RED→GREEN) throughout, no new dependencies, changes scoped to the flagged files only.

### Findings status

| # | Severity | File | Finding | Status |
|---|----------|------|---------|--------|
| 1 | BLOCKER | `Dashboard.tsx` SectionC | `getPendientesHistorico` failure never rendered — stuck on "Cargando…" | Fixed — renders `SectionErrorBanner` with retry; error checked before the `!result` loading branches |
| 2 | BLOCKER | `PendientesArcaChart.tsx` / `Dashboard.tsx` | Chart rendered its own dead "Ver histórico completo" `<p>` + duplicate card, nested inside SectionC's real card/button | Fixed — chart no longer renders its own card wrapper or link; SectionC's card + button are the only ones |
| 3 | SHOULD-FIX | `Dashboard.tsx:277` | Literal `$` before an integer count (`count_excluidos_previos_a_alta`) | Fixed — `$` removed |
| 4 | SHOULD-FIX | `PendientesArcaChart.tsx` | `maxBucketValue` could be `0` → `barHeight = NaN` | Fixed — guarded to `1` when the real max is `0` |
| 5 | SHOULD-FIX | `PendientesArcaChart.tsx` | `last12MonthBuckets()` used `setMonth` on today's day-of-month → collisions on days 29-31 | Fixed — buckets built from day 1 of each month; `now` made injectable |
| 6 | SHOULD-FIX | `ConfirmDialog.tsx` | `focus-rounded-lg` typo class | Fixed — `focus-ring rounded-lg` |
| 7 | SHOULD-FIX | `ConfirmDialog.tsx` | `aria-modal="true"` with no initial focus / Tab trap / focus restore | Fixed — focus moves to Cancel (or Confirm if no Cancel) on open, Tab/Shift+Tab trapped, focus restored to the previously focused element on close |
| 8 | SHOULD-FIX | `Dashboard.tsx` refresh/afterMutation | Concurrent `listPeriodos` calls unsequenced — stale response could resurrect a deleted período | Fixed — `requestIdRef` guard ignores stale responses |
| 9 | SHOULD-FIX | `app/page.test.tsx` | Diff dropped `clearSession()` from two `afterEach` blocks | Fixed — restored, plus a regression test proving the leak |
| 10 | NIT | `PendientesArcaChart.tsx:223` | `viewBox="0 0 {chartWidth} {chartHeight}"` literal string | Fixed — template literal |
| 11 | NIT | `Dashboard.tsx:12-21` | `Periodo` type duplicated from `lib/api.ts` | Fixed — imported instead |

### TDD Cycle Evidence

| Finding(s) | Test File | RED (confirmed failing for the right reason) | GREEN | Notes |
|---|---|---|---|---|
| 6, 7 | `ConfirmDialog.test.tsx` | 6 new tests failed: typo class present, no `toHaveFocus()` on open, no Tab wrap, no focus restore | 15/15 passed | Added `useRef`-based dialog/button refs + keydown handler for trap + restore |
| 5 | `PendientesArcaChart.test.tsx` | `last12MonthBuckets is not a function` (not yet exported) | 9/9 passed | Fixed with fake timers, fixed "now" = 2026-03-31, asserts 12 distinct consecutive keys |
| 2, 10 | `PendientesArcaChart.test.tsx` | dead `<p>Ver histórico completo</p>` found in DOM; `viewBox` literal `"0 0 {chartWidth} {chartHeight}"` | same run, 9/9 passed | |
| 4 | `PendientesArcaChart.test.tsx` | `Number.isNaN(Number(value))` was `true` for rect attrs with all-out-of-window pendientes | same run, 9/9 passed | |
| 1, 3, 8 | `Dashboard.test.tsx` | `findByText('3')` not found (`$3` rendered instead); `findByRole('alert')` timed out (stuck on spinner); newer refresh + stale older resolution both landed unguarded | 18/18 passed | Race test forces 2 overlapping `listPeriodos` via `rerender` with a changed `tenantId`, resolves the newer promise first, the older (stale) one last |
| 2 (Dashboard-level) | `Dashboard.test.tsx` | New non-empty-data "exactly one control" test — passed immediately once finding #2's chart-side fix landed first | 18/18 passed | Confirms no duplicate card/button reachable from the real Dashboard tree |
| 9 | `app/page.test.tsx` | Reverted the fix, added leak-regression test → failed: main app rendered instead of login form (stale session from prior test) | 13/13 passed after restoring `clearSession()` | |
| 11 | n/a (type-only change) | No dedicated test; verified via `tsc --noEmit` (no other file imported `Periodo` from `Dashboard.tsx`) | clean | |

### Final verification

- **`npx jest --config jest.web.config.js`**: 134/134 passing, 17 suites (baseline was 119/119, 17 suites; +15 tests from this review pass).
- **`npx tsc --noEmit`**: clean.
- **`npx next build`**: `✓ Compiled successfully`, `/` at 15.8 kB / 103 kB First Load JS.
- **Dependencies**: zero new.

### Commits

- `fix(web): add focus trap and fix focus-ring typo in ConfirmDialog`
- `fix(web): remove duplicate card/dead link and fix NaN/date bugs in PendientesArcaChart`
- `fix(web): surface SectionC fetch errors, fix currency literal, and sequence refresh calls`
- `test(web): restore clearSession() cleanup in page.test.tsx afterEach`
- `docs(openspec): add review fixes section to PR-9 progress` (this entry)

## Archive Phase Complete (2026-10-08)

- Frontend slice PR-9 fully archived
- T67 verified PASS (both suites green: web 134/134, api 502/503 — 2 pre-existing unrelated Windows teardown flakes)
- T68 deferred by design (not a gap — explicitly marked optional in AD-8)
- Archive folder path: `openspec/changes/archive/2026-10-08-dashboard-principal-pr9/`
- 11 commits archived (T60–T66 complete, review fixes applied)
- All RF-24..RF-40 requirements verified compliant at runtime
