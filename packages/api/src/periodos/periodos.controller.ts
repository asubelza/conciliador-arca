/**
 * periodos.controller.ts — T18 (RF-12): períodos CRUD-lite (create, list,
 * detail). Follows reconciliations.controller.ts's existing style — pure
 * validation functions checked first, then a direct `pg` query via the
 * shared pool (no repository/ORM layer in this codebase; prisma is
 * documentation-only, see seed-runner.ts's module doc).
 */
import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { getPgPool } from '../db/pg-pool';
import {
  validateCerrarBody,
  validateCreatePeriodoBody,
  validatePeriodoIdParam,
  validateTenantIdQuery,
} from './periodos-validation';
import { cerrarPeriodo } from './periodo-cierre';
import { getPeriodoReport } from './periodo-report';
import { buildPeriodoExportSections, toPeriodoReportCsv, toPeriodoReportXlsxBuffer } from './periodo-report-exporter';
import { validateCoincidenciaRequest } from './coincidencia-validation';
import { validatePendienteResolverRequest } from './pendiente-resolver-validation';
import { validateMarkRequest } from '../reconciliations/marks-validation';
import { insertFeedbackMark } from '../reconciliations/feedback-writer';
import { logAuditEvent } from '../reconciliations/audit-logger';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth-guard';
import { assertTenantAccess } from '../auth/tenant-access';
import { assertRole } from '../auth/role-check';

const UNIQUE_VIOLATION = '23505';

export interface PeriodoRow {
  id: string;
  tenant_id: string;
  mes: string;
  estado: 'abierto' | 'cerrado';
  tolerancia_ars: string | null;
  cerrado_at: string | null;
  cerrado_por: string | null;
  created_at: string;
}

// `mes::text` (not the bare `mes`): node-postgres parses a DATE column into
// a JS Date at local midnight, which serializes to a full UTC ISO
// datetime in the JSON response and can even shift to the previous day
// under a non-UTC server TZ. Casting to text keeps the API contract a
// plain, unambiguous 'YYYY-MM-DD' regardless of the server's TZ config.
const PERIODO_COLUMNS = "id, tenant_id, mes::text AS mes, estado, tolerancia_ars, cerrado_at, cerrado_por, created_at";

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === UNIQUE_VIOLATION;
}

/**
 * T38 (Fase 2): a cheap, dedicated lookup for the one thing detail/cerrar/
 * report need to authorize BEFORE doing any real work — the período's
 * tenant_id — rather than piggy-backing on cerrarPeriodo's/getPeriodoReport's
 * own (heavier) queries, which only resolve tenant_id as a side effect deep
 * inside logic that may already have started matching/locking rows.
 */
async function resolvePeriodoTenantId(pool: ReturnType<typeof getPgPool>, id: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ tenant_id: string }>('SELECT tenant_id FROM periodos WHERE id = $1', [id]);
  return rows[0]?.tenant_id;
}

@Controller('api/periodos')
@UseGuards(AuthGuard)
export class PeriodosController {
  /**
   * RF-12: creates a período for a tenant + calendar month. `mes` is
   * normalized to the 1st of the month so "2026-04-01", "2026-04-15", and
   * "2026-04" all collapse onto the same `UNIQUE (tenant_id, mes)` row — the
   * 409 on a duplicate is enforced by that constraint, not app-layer
   * pre-checking (safe under concurrent requests).
   *
   * The 'YYYY-MM' -> 'YYYY-MM-01' padding happens here in JS, not via a
   * Postgres cast: `'2026-05'::date` itself fails with "invalid input
   * syntax for type date" (Postgres's date parser doesn't accept a
   * year-month-only string), so `date_trunc('month', $1::date)` never gets
   * a chance to run for that input shape. `date_trunc` is still used for
   * the day-of-month case ("2026-04-15" -> "2026-04-01").
   */
  @Post()
  async create(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const failure = validateCreatePeriodoBody(body);
    if (failure) {
      throw new HttpException({ error: failure.error }, failure.status);
    }

    const roleFailure = assertRole(req.user!, ['admin', 'colaborador']);
    if (roleFailure) {
      throw new HttpException({ error: roleFailure.error }, roleFailure.status);
    }

    const { tenant_id: tenantId, mes: rawMes } = body as { tenant_id: string; mes: string };
    const mes = /^\d{4}-\d{2}$/.test(rawMes) ? `${rawMes}-01` : rawMes;
    const pool = getPgPool();

    const authFailure = await assertTenantAccess(pool, req.user!, tenantId);
    if (authFailure) {
      throw new HttpException({ error: authFailure.error }, authFailure.status);
    }

    try {
      const { rows } = await pool.query<PeriodoRow>(
        `INSERT INTO periodos (tenant_id, mes)
         VALUES ($1, date_trunc('month', $2::date))
         RETURNING ${PERIODO_COLUMNS}`,
        [tenantId, mes],
      );
      return rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HttpException(
          { error: `tenant ${tenantId} already has a período for that month` },
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }

  /** RF-12: lists a tenant's períodos, most recent month first. */
  @Get()
  async list(@Query('tenant_id') tenantId: unknown, @Req() req: AuthenticatedRequest) {
    const failure = validateTenantIdQuery(tenantId);
    if (failure) {
      throw new HttpException({ error: failure.error }, failure.status);
    }

    const pool = getPgPool();
    const authFailure = await assertTenantAccess(pool, req.user!, tenantId as string);
    if (authFailure) {
      throw new HttpException({ error: authFailure.error }, authFailure.status);
    }

    const { rows } = await pool.query<PeriodoRow>(
      `SELECT ${PERIODO_COLUMNS} FROM periodos WHERE tenant_id = $1 ORDER BY mes DESC`,
      [tenantId],
    );
    return { periodos: rows };
  }

  /**
   * RF-12: período detail. Scope note: architecture.md's draft for this
   * endpoint also described a "resumen de conteos actuales" (current counts
   * summary) — that depends on vouchers_canonical.periodo_alta_id /
   * reconciliation_results.periodo_id, which don't exist until Phase 2
   * (T21+), so it's left out of this response for now rather than added
   * against columns that don't exist yet.
   */
  @Get(':id')
  async detail(@Param('id') id: unknown, @Req() req: AuthenticatedRequest) {
    const failure = validatePeriodoIdParam(id);
    if (failure) {
      throw new HttpException({ error: failure.error }, failure.status);
    }

    const pool = getPgPool();
    const { rows } = await pool.query<PeriodoRow>(
      `SELECT ${PERIODO_COLUMNS} FROM periodos WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) {
      throw new HttpException({ error: 'período not found' }, HttpStatus.NOT_FOUND);
    }

    const authFailure = await assertTenantAccess(pool, req.user!, rows[0].tenant_id);
    if (authFailure) {
      throw new HttpException({ error: authFailure.error }, authFailure.status);
    }

    return rows[0];
  }

  /**
   * T27/T28 (RF-20/RF-21): "Cerrar Conciliación del Mes" — persists final
   * conciliado/pendiente states, freezes the período's report snapshot, and
   * snapshots the tolerance used. All the real work (including the 409 on
   * an already-cerrado período) lives in periodo-cierre.ts, which runs
   * entirely inside one transaction; this handler only maps its typed
   * result/failure to an HTTP response.
   */
  @Post(':id/cerrar')
  @HttpCode(HttpStatus.OK)
  async cerrar(@Param('id') id: unknown, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const idFailure = validatePeriodoIdParam(id);
    if (idFailure) {
      throw new HttpException({ error: idFailure.error }, idFailure.status);
    }
    const bodyFailure = validateCerrarBody(body);
    if (bodyFailure) {
      throw new HttpException({ error: bodyFailure.error }, bodyFailure.status);
    }

    const roleFailure = assertRole(req.user!, ['admin', 'colaborador']);
    if (roleFailure) {
      throw new HttpException({ error: roleFailure.error }, roleFailure.status);
    }

    const pool = getPgPool();
    // Resolve the período's tenant_id and authorize BEFORE cerrarPeriodo
    // does any writes (architecture.md: "se resuelve primero, luego se
    // autoriza, antes de cualquier escritura"). A genuinely missing
    // período still surfaces its 404 from cerrarPeriodo's own check below —
    // this only short-circuits the write path when the período DOES exist
    // but the caller isn't allowed to touch it.
    const tenantId = await resolvePeriodoTenantId(pool, id as string);
    if (tenantId !== undefined) {
      const authFailure = await assertTenantAccess(pool, req.user!, tenantId);
      if (authFailure) {
        throw new HttpException({ error: authFailure.error }, authFailure.status);
      }
    }

    const cerradoPor = (body as { cerrado_por?: string } | null)?.cerrado_por ?? null;
    const result = await cerrarPeriodo(pool, id as string, cerradoPor);
    if ('code' in result) {
      throw new HttpException({ error: result.error }, result.status);
    }
    return result;
  }

  /**
   * T29 (RF-22/RF-23): the 3-section período report — live while abierto,
   * frozen once cerrado (see periodo-report.ts's module doc). Logged as an
   * 'export' audit event, same as the per-job report endpoint (T12/RF-11),
   * so every report view/download is traceable regardless of which
   * endpoint served it.
   *
   * `format=csv|xlsx` (client-requested 2026-08-22, "con diseño
   * profesional" for xlsx — see periodo-report-exporter.ts) added on top of
   * T29's original `json`-only scope; default stays `json` so the existing
   * frontend viewer (which never passes `format`) is unaffected.
   */
  @Get(':id/report')
  async report(
    @Param('id') id: unknown,
    @Query('format') format: unknown,
    @Res() res: Response,
    @Req() req: AuthenticatedRequest,
  ) {
    const idFailure = validatePeriodoIdParam(id);
    if (idFailure) {
      throw new HttpException({ error: idFailure.error }, idFailure.status);
    }

    const resolvedFormat = format === undefined ? 'json' : format;
    if (resolvedFormat !== 'json' && resolvedFormat !== 'csv' && resolvedFormat !== 'xlsx') {
      throw new HttpException({ error: "format must be 'json', 'csv', or 'xlsx'" }, HttpStatus.BAD_REQUEST);
    }

    const pool = getPgPool();

    // Same "resolve, then authorize, before real work" posture as cerrar —
    // this report can be expensive to build (a live período re-runs the
    // full match), so authorizing off a cheap tenant_id-only lookup first
    // avoids doing that work for a tenant the caller can't see. A missing
    // período still gets its 404 from getPeriodoReport's own check below.
    const tenantId = await resolvePeriodoTenantId(pool, id as string);
    if (tenantId !== undefined) {
      const authFailure = await assertTenantAccess(pool, req.user!, tenantId);
      if (authFailure) {
        throw new HttpException({ error: authFailure.error }, authFailure.status);
      }
    }

    const result = await getPeriodoReport(pool, id as string);
    if ('code' in result) {
      throw new HttpException({ error: result.error }, result.status);
    }

    await logAuditEvent(pool, {
      tenantId: result.periodo.tenant_id,
      action: 'export',
      entity: 'periodo',
      entityId: id as string,
      details: { format: resolvedFormat, live: result.live },
    });

    if (resolvedFormat === 'json') {
      res.json(result);
      return;
    }

    const exportSections = buildPeriodoExportSections(result.sections);

    if (resolvedFormat === 'xlsx') {
      const buffer = await toPeriodoReportXlsxBuffer(exportSections, result.periodo, result.live);
      res
        .set({
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="periodo-${result.periodo.mes}-${id}.xlsx"`,
        })
        .send(buffer);
      return;
    }

    const csv = toPeriodoReportCsv(exportSections);
    res
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="periodo-${result.periodo.mes}-${id}.csv"`,
      })
      .send(csv);
  }

  /**
   * RF-04/RF-13: contador confirma o descarta una sugerencia de coincidencia
   * por similitud (periodo-matching-engine.ts's `posible_coincidencia`
   * classification, from the AskUserQuestion design answers: "Nueva
   * categoría 'Posible coincidencia'... el contador confirma o descarta con
   * un click"). This endpoint only persists the decision into
   * `fuzzy_match_confirmations`; a 'confirmado' pairing is then picked up
   * automatically by matchPeriodo's fetchFuzzyConfirmations on the NEXT
   * report read and treated exactly like an exact composite-key match — see
   * periodo-matching-engine.ts's module doc. Restricted to an abierto
   * período: once cerrado, the report is a frozen snapshot
   * (periodo-report.ts / periodo-cierre.ts) that a later confirmation can no
   * longer change, so accepting one against a cerrado período would
   * silently do nothing visible — rejected outright instead (409, same
   * status the cerrar-twice case uses for "this período's state won't allow
   * that").
   */
  @Post(':id/coincidencias')
  @HttpCode(HttpStatus.OK)
  async coincidencia(@Param('id') id: unknown, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const idFailure = validatePeriodoIdParam(id);
    if (idFailure) {
      throw new HttpException({ error: idFailure.error }, idFailure.status);
    }

    const validation = validateCoincidenciaRequest(body);
    if (!validation.ok) {
      throw new HttpException({ error: validation.failure.error }, validation.failure.status);
    }

    const roleFailure = assertRole(req.user!, ['admin', 'colaborador']);
    if (roleFailure) {
      throw new HttpException({ error: roleFailure.error }, roleFailure.status);
    }

    const pool = getPgPool();
    const { rows: periodoRows } = await pool.query<{ tenant_id: string; estado: 'abierto' | 'cerrado' }>(
      'SELECT tenant_id, estado FROM periodos WHERE id = $1',
      [id],
    );
    if (periodoRows.length === 0) {
      throw new HttpException({ error: 'período not found' }, HttpStatus.NOT_FOUND);
    }
    const { tenant_id: tenantId, estado } = periodoRows[0];

    const authFailure = await assertTenantAccess(pool, req.user!, tenantId);
    if (authFailure) {
      throw new HttpException({ error: authFailure.error }, authFailure.status);
    }

    if (estado === 'cerrado') {
      throw new HttpException(
        { error: 'período is closed — coincidencia confirmations only apply to an abierto período' },
        HttpStatus.CONFLICT,
      );
    }

    const { sistema_voucher_id, arca_voucher_id, accion } = validation.value;

    // Both vouchers must exist and belong to THIS tenant — the pair should
    // always come straight from this tenant's own report, so an unknown or
    // cross-tenant id here is a client bug, surfaced as 404 rather than left
    // to fail opaquely on the FK constraint below.
    const { rows: voucherRows } = await pool.query<{ id: string }>(
      'SELECT id FROM vouchers_canonical WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
      [tenantId, [sistema_voucher_id, arca_voucher_id]],
    );
    if (voucherRows.length !== 2) {
      throw new HttpException(
        { error: 'sistema_voucher_id / arca_voucher_id must both reference existing vouchers for this tenant' },
        HttpStatus.NOT_FOUND,
      );
    }

    const status = accion === 'confirmar' ? 'confirmado' : 'descartado';

    const { rows } = await pool.query<{
      tenant_id: string;
      sistema_voucher_id: string;
      arca_voucher_id: string;
      status: string;
      created_by: string | null;
      created_at: string;
    }>(
      `INSERT INTO fuzzy_match_confirmations (tenant_id, sistema_voucher_id, arca_voucher_id, status, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (sistema_voucher_id, arca_voucher_id)
       DO UPDATE SET status = EXCLUDED.status, created_by = EXCLUDED.created_by, created_at = now()
       RETURNING tenant_id, sistema_voucher_id, arca_voucher_id, status, created_by, created_at`,
      [tenantId, sistema_voucher_id, arca_voucher_id, status, req.user!.id],
    );

    await logAuditEvent(pool, {
      tenantId,
      userId: req.user!.id,
      action: status === 'confirmado' ? 'confirm_similarity' : 'discard_similarity',
      entity: 'vouchers_canonical',
      entityId: sistema_voucher_id,
      details: { arca_voucher_id, status },
    });

    return rows[0];
  }

  /**
   * 2026-08-23 (client request, feature 2 de 3): "Marcar como resuelto sin
   * pareja" — para un comprobante ARCA de la sección Pendientes en ARCA que
   * el contador ya sabe que nunca va a tener su contraparte en el sistema
   * contable (ej. cargado en ARCA muchos meses antes de que el cliente
   * empezara a usar el sistema). A diferencia de `coincidencias`, que
   * vincula DOS vouchers (sistema + arca), este resuelve UNO solo — pone su
   * `estado` directamente en 'conciliado' sin ningún par del lado
   * contabilidad, así deja de aparecer en `pendiente_en_arca` en cualquier
   * período futuro (matchPeriodo filtra siempre `estado <> 'conciliado'`).
   * No se reutiliza `fuzzy_match_confirmations` (esa tabla es para pares
   * sistema+arca — este caso no tiene sistema del otro lado). Sin gate por
   * período abierto/cerrado (a diferencia de `coincidencias`): esta acción
   * cambia el voucher en sí, no el snapshot de ESTE período — el `id` de la
   * URL es solo de dónde se disparó el botón en la UI.
   */
  @Post(':id/pendientes-arca-resolver')
  @HttpCode(HttpStatus.OK)
  async resolverPendienteArca(@Param('id') id: unknown, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const idFailure = validatePeriodoIdParam(id);
    if (idFailure) {
      throw new HttpException({ error: idFailure.error }, idFailure.status);
    }

    const validation = validatePendienteResolverRequest(body);
    if (!validation.ok) {
      throw new HttpException({ error: validation.failure.error }, validation.failure.status);
    }

    const roleFailure = assertRole(req.user!, ['admin', 'colaborador']);
    if (roleFailure) {
      throw new HttpException({ error: roleFailure.error }, roleFailure.status);
    }

    const pool = getPgPool();
    const tenantId = await resolvePeriodoTenantId(pool, id as string);
    if (tenantId === undefined) {
      throw new HttpException({ error: 'período not found' }, HttpStatus.NOT_FOUND);
    }

    const authFailure = await assertTenantAccess(pool, req.user!, tenantId);
    if (authFailure) {
      throw new HttpException({ error: authFailure.error }, authFailure.status);
    }

    const { arca_voucher_id: arcaVoucherId, nota } = validation.value;

    const { rows: voucherRows } = await pool.query<{ id: string; file_source: string; estado: string }>(
      'SELECT id, file_source, estado FROM vouchers_canonical WHERE tenant_id = $1 AND id = $2',
      [tenantId, arcaVoucherId],
    );
    if (voucherRows.length === 0) {
      throw new HttpException(
        { error: 'arca_voucher_id must reference an existing voucher for this tenant' },
        HttpStatus.NOT_FOUND,
      );
    }
    if (voucherRows[0].file_source !== 'arca') {
      throw new HttpException(
        { error: 'arca_voucher_id must be an ARCA-side voucher — only ARCA pendientes are resolved this way' },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (voucherRows[0].estado === 'conciliado') {
      throw new HttpException({ error: 'this voucher is already conciliado' }, HttpStatus.CONFLICT);
    }

    const { rows: updatedRows } = await pool.query<{ id: string; estado: string }>(
      `UPDATE vouchers_canonical SET estado = 'conciliado' WHERE id = $1 RETURNING id, estado`,
      [arcaVoucherId],
    );

    await logAuditEvent(pool, {
      tenantId,
      userId: req.user!.id,
      action: 'resolve_pendiente_manual',
      entity: 'vouchers_canonical',
      entityId: arcaVoucherId,
      details: { periodo_id: id as string, nota },
    });

    return updatedRows[0];
  }

  /**
   * RF-09: período-scoped mark (`revisado`/`explicado`), feeding
   * periodo-report.ts's `attachFeedbackAndReprioritize` (from the
   * AskUserQuestion design answer: "Mostrar la nota anterior + bajar
   * prioridad, nunca ocultar"). Reuses marks-validation.ts/feedback-writer.ts
   * from the per-job endpoint (T12, `POST /api/reconciliations/:jobId/marks`)
   * — same `feedback_loop` table, same classifications — with two
   * deliberate differences: (1) scoped by período id rather than job id, so
   * a mark can be made straight from the período report UI even for a
   * comprobante that was never part of a single upload job's own result set
   * (e.g. carried over from a prior período as pendiente_en_arca); and (2)
   * the user id comes from the authenticated JWT (`req.user!.id`), never a
   * body-supplied `user_id` — the older job-scoped endpoint predates auth
   * and still trusts the body for that field (see marks-validation.ts's own
   * doc comment); this one is written correctly from the start rather than
   * copying that pre-auth gap forward.
   */
  @Post(':id/marks')
  @HttpCode(HttpStatus.CREATED)
  async mark(@Param('id') id: unknown, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const idFailure = validatePeriodoIdParam(id);
    if (idFailure) {
      throw new HttpException({ error: idFailure.error }, idFailure.status);
    }

    const validation = validateMarkRequest(body);
    if (!validation.ok) {
      throw new HttpException({ error: validation.failure.error }, validation.failure.status);
    }

    const roleFailure = assertRole(req.user!, ['admin', 'colaborador']);
    if (roleFailure) {
      throw new HttpException({ error: roleFailure.error }, roleFailure.status);
    }

    const pool = getPgPool();
    const tenantId = await resolvePeriodoTenantId(pool, id as string);
    if (tenantId === undefined) {
      throw new HttpException({ error: 'período not found' }, HttpStatus.NOT_FOUND);
    }

    const authFailure = await assertTenantAccess(pool, req.user!, tenantId);
    if (authFailure) {
      throw new HttpException({ error: authFailure.error }, authFailure.status);
    }

    const mark = await insertFeedbackMark(pool, tenantId, { ...validation.value, user_id: req.user!.id });

    await logAuditEvent(pool, {
      tenantId,
      userId: req.user!.id,
      action: 'user_mark',
      entity: 'feedback_loop',
      entityId: mark.id,
      details: { composite_key: validation.value.composite_key, classification: validation.value.classification },
    });

    return mark;
  }
}
