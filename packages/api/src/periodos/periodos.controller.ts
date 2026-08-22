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
}
