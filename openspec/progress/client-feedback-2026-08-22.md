# Client feedback (2026-08-22) — antigüedad fix + período report export

**Branch:** `feature/mvp-carga-comprobantes-pr-3` (same branch as PR-4/5/6 and the `app_role` grants fix).

**Context:** after PR-6 shipped, two design decisions flagged in `openspec/progress/PR-5.md`/`PR-6.md` as "not confirmed with the client" were put to the client directly. Their answers surfaced one real bug and one feature request — both implemented and verified against real Postgres in this round.

## 1. RF-19 antigüedad_meses was computed from the wrong date (real bug, now fixed)

**Question asked:** whether a pendiente ARCA voucher's antigüedad should be measured from when it first entered the system (`periodo_alta_id`) or from its real fecha de emisión, given re-uploads of the same ARCA range/acumulado are common.

**Client's answer (verbatim):** *"La antigüedad se debe calcular siempre en base a la Fecha de Emisión real del comprobante en ARCA (o el mes/año del comprobante), nunca en función de la fecha de carga del archivo al sistema. Si un comprobante fue emitido en ARCA en Noviembre y la empresa lo termina registrando en Febrero, la antigüedad/diferimiento es de 3 meses, sin importar si el archivo de ARCA de Noviembre se subió una o varias veces."*

This is a real bug fix, not a new feature: `periodo-matching-engine.ts`'s `antiguedad_meses` (shipped in PR-5/T26) was computed as the calendar-month gap between the *viewed período* and `periodo_alta_id`'s own mes — i.e. it measured upload timing, not the voucher's real age. For a voucher uploaded promptly this never showed a difference; it would have been silently wrong the first time an accountant re-uploaded an old ARCA range months after the voucher was actually emitted (exactly the "acumulado anual" workflow the client's original proposal describes in section 9).

**Fix:** `fetchAntiguedadLookup` (periodo_alta_id-keyed) replaced with `fetchViewedPeriodoYearMonth` + a per-row calendar-month diff against `vouchers_canonical.fecha` (the real fecha de emisión, already stored on every ARCA row). `periodo_alta_id` keeps its original job — deciding which ARCA rows count as "this período's own upload" (corriente) vs. historical stock — it's just no longer what antigüedad measures.

**Re-upload/reingreso semantics (the second half of the client's answer):** *"Es totalmente habitual volver a cargar archivos... Si ya existe: Simplemente omite la inserción (o actualiza datos si hiciera falta), manteniendo su estado original (PENDIENTE o CONCILIADO)."* — checked against `vouchers-canonical-writer.ts`'s existing upsert (shipped in PR-5/T22) and confirmed it already does exactly this: a conflicting upsert on an already-`conciliado` row is a no-op (estado preserved), a `pendiente` row's data is refreshed in place (no duplicate row), and ARCA's `periodo_alta_id` never moves after first insert. No code change needed here — only the module doc comment was updated to record the confirmation instead of "a judgment call, not confirmed with the client."

**Real Postgres verification:**
- `periodo-matching-engine.test.ts`: existing RF-19 test updated to set an explicit `fecha`; two new tests added — one reproducing the client's exact Nov-emitted/Feb-registered scenario (antiguedad = 5 months by fecha, would have wrongly been 2 months by the old periodo_alta_id logic), one confirming a voucher with no captured fecha reports `antiguedad_meses: undefined` rather than a wrong number.
- `periodo-report.test.ts`: its one antiguedad-asserting fixture updated to set a matching `fecha` (previously relied on the old periodo_alta_id-based default).
- `vouchers-canonical-writer.test.ts`: untouched — its 8 existing tests already covered the reingreso contract; all still pass unchanged.

## 2. `GET /api/periodos/:id/report`: format=csv/xlsx added, "diseño profesional"

**Question asked:** whether the period-close report needs to be downloadable (CSV/Excel), like the per-job report already is, or whether the on-screen view is enough.

**Client's answer (verbatim):** *"Si descargar en csv/xlsx con diseño profesional."*

**What was built:** `periodo-report-exporter.ts` (new) — `format=csv` (a flat table with a `seccion` column, 2-decimal money fields) and `format=xlsx` styled explicitly for "diseño profesional", distinct from the plain per-job exporter (`report-generator.ts`'s `toXlsxBuffer`, deliberately left as-is — different report, different taxonomy, see PR-6.md's design decision #1 for why they were never merged):

- One sheet per section (Conciliados OK / Discrepancias y Alertas / Pendientes en ARCA — same labels the on-screen viewer uses), each with a merged title row naming the período + section, a subtitle row stating live vs. frozen state and row count, a colored bold header row (green / amber / slate, matching each section's meaning) with borders and an autofilter, frozen header, sized columns, zebra-striped data rows, accounting-style 2-decimal formatting on every money column, and `dd/mm/yyyy` dates.
- Wired into the existing `GET /api/periodos/:id/report` endpoint via `?format=csv|xlsx` (default stays `json`, so the existing frontend viewer — which never passes `format` — is unaffected). Same `export` audit-log entry as before, now recording the real format requested.
- Frontend: `PeriodoReportViewer.tsx` gained "Descargar CSV"/"Descargar Excel" links next to the live/frozen status line, same `<a href>` pattern `ReportViewer.tsx` already uses for the per-job report — no JS fetch needed, the browser handles the download from the `Content-Disposition` header.

**Real verification:**
- `periodo-report-exporter.test.ts` (new, 7 tests): row-flattening/sorting, CSV shape, and the XLSX workbook loaded back through a real `ExcelJS.Workbook.load()` — asserting actual sheet names, the merged title cell's text, the header row's fill color, numFmt on money columns, and the dd/mm/yyyy date format, not just "a buffer was returned."
- `periodos.controller.test.ts`: 2 new integration tests — `format=csv`/`format=xlsx` both download successfully with the right `Content-Type`/`Content-Disposition`, and an unsupported `format` value 400s.
- `PeriodoReportViewer.test.tsx`: 1 new test asserting both download links render with the correct `href`.

## Test Summary

- `packages/api`: **342/342 passing** (was 331 before this round — 11 new: 2 in `periodo-matching-engine.test.ts`, 7 in `periodo-report-exporter.test.ts`, 2 in `periodos.controller.test.ts`). `npx tsc --noEmit` and `npx nest build` both clean.
- `packages/web`: **21/21 passing** (was 20 — 1 new in `PeriodoReportViewer.test.tsx`). `npx next build` compiles and type-checks cleanly.
- No regressions: every prior test (PR-1 through PR-6, the `app_role` grants suite) still passes unchanged.
