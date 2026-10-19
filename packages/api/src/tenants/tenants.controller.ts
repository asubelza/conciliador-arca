/**
 * tenants.controller.ts — T20 (RF-18): per-tenant amount tolerance
 * configuration (`tenants.tolerancia_redondeo_ars`, 014_alter_tenants_add_tolerancia.sql).
 * The client's functional spec calls for a rounding tolerance on amount
 * matching; the user chose "por tenant" over a single global value when
 * asked during the conciliacion-periodica proposal review.
 */
import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Param, Patch, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { getPgPool } from '../db/pg-pool';
import { isUuid, validateTenantIdParam, validateUpdateTenantConfigBody } from './tenants-validation';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth-guard';
import { assertTenantAccess } from '../auth/tenant-access';
import { assertRole } from '../auth/role-check';
import type { AuthenticatedUser } from '../auth/users-types';
import { fetchPendientesHistorico, fetchVouchersForExport } from './pendientes-historico';
import { validateComprobanteArcaManualRequest } from './comprobante-arca-manual-validation';
import { createComprobanteArcaManual } from './comprobante-arca-manual';
import {
  validateArchivarComprobanteRequest,
  validateArchivarComprobantesLoteRequest,
} from './comprobante-arca-archivar-validation';
import { archivarComprobanteArca, archivarComprobantesArcaLote, desarchivarComprobanteArca } from './comprobante-arca-archivar';
import { validatePendientesHistoricoExportRequest } from './pendientes-historico-export-validation';
import { toPendientesHistoricoCsv, toPendientesHistoricoXlsxBuffer } from './pendientes-historico-exporter';
import { validateCreateTenantBody, validateUpdateTenantBody } from './tenants-admin-validation';

export interface TenantConfigRow {
  id: string;
  tolerancia_redondeo_ars: string;
  tolerancia_dias_fecha: number;
}

export interface TenantRow {
  id: string;
  name: string;
  cuit: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Multi-estudio pivot: every estudio-scoped write/list in this controller
 * needs the caller's OWN estudio_id, and platform-level staff (null) must
 * be rejected with the SAME 403 assertTenantAccess itself uses for that
 * case — factored into one helper (rather than four copies of the same
 * inline check) specifically so a future route can't end up missing it the
 * way updateTenant/setActive originally did (caught in code review: both
 * relied on `estudio_id = NULL` never matching a row instead of 403ing
 * explicitly, which is correct-by-accident, not correct-by-construction).
 */
function requireEstudioId(user: AuthenticatedUser): string {
  if (user.estudio_id === null) {
    throw new HttpException({ error: 'no tenés acceso a este tenant' }, HttpStatus.FORBIDDEN);
  }
  return user.estudio_id;
}

/**
 * T38 (Fase 2, autenticacion-roles): every endpoint here requires a valid
 * token (class-level @UseGuards — this controller has no unauthenticated
 * endpoint, unlike AuthController). `:id` IS the tenant id, so
 * assertTenantAccess runs directly against the param, no extra lookup
 * needed. PUT is admin-only per architecture.md's authorization table; GET
 * is open to all 3 roles, subject to assertTenantAccess.
 */
@Controller('api/tenants')
@UseGuards(AuthGuard)
export class TenantsController {
  /**
   * Backoffice self-service (admin-only): list every tenant WITHIN THE
   * CALLER'S OWN ESTUDIO. No tenant `:id` to scope by, so this can't go
   * through assertTenantAccess — it filters by req.user.estudio_id
   * directly, the same boundary assertTenantAccess itself now enforces
   * (multi-estudio pivot). Platform-level staff (estudio_id === null) gets
   * 403, not an empty list — same "no implicit access to any estudio"
   * posture as listMyTenants/assertTenantAccess.
   */
  @Get()
  async listTenants(@Req() req: AuthenticatedRequest) {
    const roleFailure = assertRole(req.user!, ['admin']);
    if (roleFailure) {
      throw new HttpException({ error: roleFailure.error }, roleFailure.status);
    }
    const estudioId = requireEstudioId(req.user!);

    const pool = getPgPool();
    const { rows } = await pool.query<TenantRow>(
      'SELECT id, name, cuit, active, created_at, updated_at FROM tenants WHERE estudio_id = $1 ORDER BY name ASC',
      [estudioId],
    );
    return rows;
  }

  /**
   * Backoffice self-service (admin-only): create a tenant (name + cuit only
   * — see tenants-admin-validation.ts) INSIDE the caller's own estudio.
   * estudio_id always comes from req.user, never the request body — same
   * posture as every other estudio-scoped write in this pivot. Platform-
   * level staff (estudio_id === null) gets 403: tenants belong to an
   * estudio, and platform staff doesn't have one.
   */
  @Post()
  async createTenant(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const validation = validateCreateTenantBody(body);
    if (!validation.ok) {
      throw new HttpException({ error: validation.failure.error }, validation.failure.status);
    }

    const roleFailure = assertRole(req.user!, ['admin']);
    if (roleFailure) {
      throw new HttpException({ error: roleFailure.error }, roleFailure.status);
    }
    const estudioId = requireEstudioId(req.user!);

    const pool = getPgPool();
    const { rows } = await pool.query<TenantRow>(
      'INSERT INTO tenants (name, cuit, estudio_id) VALUES ($1, $2, $3) RETURNING id, name, cuit, active, created_at, updated_at',
      [validation.value.name, validation.value.cuit, estudioId],
    );
    return rows[0];
  }

  /**
   * Backoffice self-service (admin-only): edit a tenant's name/cuit.
   * Separate from PUT :id/config below (that one edits matching-tolerance
   * settings, this one edits identity fields) — different resource,
   * different body shape, kept as its own route rather than overloading
   * :id/config with unrelated fields.
   *
   * No assertTenantAccess call here (unlike the :id-scoped GET routes
   * below): assertRole already restricts this route to 'admin'. Multi-
   * estudio pivot: requireEstudioId() rejects platform-level staff (403,
   * same as listTenants/createTenant) BEFORE the UPDATE runs — relying on
   * `estudio_id = NULL` never matching a row would also "work" (0 rows →
   * 404), but that's correct by accident, not by construction, and would
   * return a different status than every other estudio-scoped route for
   * the exact same actor. The `AND estudio_id = $N` below still does its
   * job for the "wrong estudio, not null" case: collapsing "not found"
   * and "not yours" into the same 404 (no existence leak, same posture as
   * tenant-access.ts's own doc).
   */
  @Put(':id')
  async updateTenant(@Param('id') id: unknown, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const idFailure = validateTenantIdParam(id);
    if (idFailure) {
      throw new HttpException({ error: idFailure.error }, idFailure.status);
    }

    const validation = validateUpdateTenantBody(body);
    if (!validation.ok) {
      throw new HttpException({ error: validation.failure.error }, validation.failure.status);
    }

    const roleFailure = assertRole(req.user!, ['admin']);
    if (roleFailure) {
      throw new HttpException({ error: roleFailure.error }, roleFailure.status);
    }
    const estudioId = requireEstudioId(req.user!);

    const pool = getPgPool();
    const { rows } = await pool.query<TenantRow>(
      `UPDATE tenants SET name = $1, cuit = $2, updated_at = now()
       WHERE id = $3 AND estudio_id = $4
       RETURNING id, name, cuit, active, created_at, updated_at`,
      [validation.value.name, validation.value.cuit, id, estudioId],
    );
    if (rows.length === 0) {
      throw new HttpException({ error: 'tenant not found' }, HttpStatus.NOT_FOUND);
    }
    return rows[0];
  }

  /**
   * Backoffice self-service (admin-only): disable/enable a tenant, mirroring
   * users.controller.ts's PATCH :id setActive. A different HTTP verb than
   * PUT :id above (that one edits name/cuit; this one only flips `active`) —
   * no NEVER_ONBOARDED-style guard is needed here, unlike setUserActive:
   * enabling a tenant has no extra precondition.
   *
   * Disabling only blocks `cliente`-role access to this tenant
   * (tenant-access.ts's assertTenantAccess, cliente branch) — admin/colaborador
   * are unaffected, so they can still reactivate it or do cleanup.
   *
   * Multi-estudio pivot: requireEstudioId() rejects platform-level staff
   * (403) BEFORE the UPDATE runs, same reasoning as updateTenant above;
   * `AND estudio_id = $N` in the UPDATE's WHERE still collapses "not
   * found" vs "not yours" for the "wrong estudio, not null" case.
   */
  @Patch(':id')
  async setActive(@Param('id') id: unknown, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    if (!isUuid(id)) {
      throw new HttpException({ error: 'tenant id must be a UUID' }, HttpStatus.BAD_REQUEST);
    }

    const roleFailure = assertRole(req.user!, ['admin']);
    if (roleFailure) {
      throw new HttpException({ error: roleFailure.error }, roleFailure.status);
    }
    const estudioId = requireEstudioId(req.user!);

    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.active !== 'boolean') {
      throw new HttpException({ error: 'active is required and must be a boolean' }, HttpStatus.BAD_REQUEST);
    }

    const pool = getPgPool();
    const { rows } = await pool.query<{ id: string; active: boolean }>(
      'UPDATE tenants SET active = $1, updated_at = now() WHERE id = $2 AND estudio_id = $3 RETURNING id, active',
      [b.active, id, estudioId],
    );
    if (rows.length === 0) {
      throw new HttpException({ error: 'tenant not found' }, HttpStatus.NOT_FOUND);
    }
    return rows[0];
  }

  @Get(':id/config')
  async getConfig(@Param('id') id: unknown, @Req() req: AuthenticatedRequest) {
    const failure = validateTenantIdParam(id);
    if (failure) {
      throw new HttpException({ error: failure.error }, failure.status);
    }

    const pool = getPgPool();
    const authFailure = await assertTenantAccess(pool, req.user!, id as string);
    if (authFailure) {
      throw new HttpException({ error: authFailure.error }, authFailure.status);
    }

    const { rows } = await pool.query<TenantConfigRow>(
      'SELECT id, tolerancia_redondeo_ars, tolerancia_dias_fecha FROM tenants WHERE id = $1',
      [id],
    );
    if (rows.length === 0) {
      throw new HttpException({ error: 'tenant not found' }, HttpStatus.NOT_FOUND);
    }
    return rows[0];
  }

  /**
   * 2026-08-23 (client request, feature 3 de 3): "pantalla que muestre el
   * resumen de unmatch de arca... tomando como filtro desde el mes en que
   * por primera vez el cliente empezo a usar el sistema" — read-only, same
   * role posture as GET :id/config (open to all 3 roles, gated by
   * assertTenantAccess only). See pendientes-historico.ts for the filter
   * logic and the RNF-07 "never hide" reasoning behind the separate
   * excluidos_previos_a_alta bucket.
   */
  @Get(':id/pendientes-historico')
  async getPendientesHistorico(@Param('id') id: unknown, @Req() req: AuthenticatedRequest) {
    const failure = validateTenantIdParam(id);
    if (failure) {
      throw new HttpException({ error: failure.error }, failure.status);
    }

    const pool = getPgPool();
    const authFailure = await assertTenantAccess(pool, req.user!, id as string);
    if (authFailure) {
      throw new HttpException({ error: authFailure.error }, authFailure.status);
    }

    const result = await fetchPendientesHistorico(pool, id as string);
    if ('code' in result) {
      throw new HttpException({ error: result.error }, result.status);
    }
    return result;
  }

  /**
   * 2026-10-12 (Histórico filters + export): exports an arbitrary,
   * caller-chosen subset of pendientes-historico rows — PendientesHistoricoViewer.tsx's
   * "Descargar Excel/CSV" buttons send exactly the `voucher_ids` currently
   * visible after its client-side filters (across any of the 3 buckets),
   * never the whole unfiltered dataset.
   *
   * Same read/export role posture as GET .../pendientes-historico above:
   * open to all 3 roles, gated by assertTenantAccess only, no assertRole
   * call — exporting what you can already see on screen isn't a new
   * privilege, so this doesn't invent a stricter rule than the screen it
   * exports from.
   *
   * `voucher_ids` not matching this tenant (wrong tenant, or an id that
   * doesn't exist at all) are silently excluded from the file rather than
   * rejected — see fetchVouchersForExport's own doc in pendientes-historico.ts.
   */
  @Post(':id/pendientes-historico/export')
  @HttpCode(HttpStatus.OK)
  async exportPendientesHistorico(
    @Param('id') id: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const idFailure = validateTenantIdParam(id);
    if (idFailure) {
      throw new HttpException({ error: idFailure.error }, idFailure.status);
    }

    const validation = validatePendientesHistoricoExportRequest(body);
    if (!validation.ok) {
      throw new HttpException({ error: validation.failure.error }, validation.failure.status);
    }

    const pool = getPgPool();
    const authFailure = await assertTenantAccess(pool, req.user!, id as string);
    if (authFailure) {
      throw new HttpException({ error: authFailure.error }, authFailure.status);
    }

    const rows = await fetchVouchersForExport(pool, id as string, validation.value.voucher_ids);

    if (validation.value.format === 'xlsx') {
      const buffer = await toPendientesHistoricoXlsxBuffer(rows);
      res
        .set({
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="pendientes-historico-${id}.xlsx"`,
        })
        .send(buffer);
      return;
    }

    const csv = toPendientesHistoricoCsv(rows);
    res
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="pendientes-historico-${id}.csv"`,
      })
      .send(csv);
  }

  /**
   * 2026-10-12: "manual ARCA voucher creation" — a contador sometimes finds
   * a comprobante directly in AFIP's own portal that was never captured by
   * any uploaded ARCA file; this registers it by hand so it enters the
   * normal matching engine as a regular pendiente ARCA voucher. Tenant-wide
   * (not período-scoped), same home as pendientes-historico — `periodo_alta_id`
   * is resolved internally from the tenant's current `abierto` período (or
   * NULL if it has none) by createComprobanteArcaManual.ts, which also
   * delegates actual persistence to upsertVouchersCanonical, the SAME
   * writer every uploaded-file job uses.
   */
  @Post(':id/comprobantes-arca')
  async createComprobanteArca(@Param('id') id: unknown, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const idFailure = validateTenantIdParam(id);
    if (idFailure) {
      throw new HttpException({ error: idFailure.error }, idFailure.status);
    }

    const validation = validateComprobanteArcaManualRequest(body);
    if (!validation.ok) {
      throw new HttpException({ error: validation.failure.error }, validation.failure.status);
    }

    const roleFailure = assertRole(req.user!, ['admin', 'colaborador']);
    if (roleFailure) {
      throw new HttpException({ error: roleFailure.error }, roleFailure.status);
    }

    const pool = getPgPool();
    const authFailure = await assertTenantAccess(pool, req.user!, id as string);
    if (authFailure) {
      throw new HttpException({ error: authFailure.error }, authFailure.status);
    }

    const result = await createComprobanteArcaManual(pool, id as string, validation.value, req.user!.id);
    if ('code' in result) {
      throw new HttpException({ error: result.error }, result.status);
    }
    return result;
  }

  /**
   * 2026-10-12 (Histórico filters + "Archivar", client dashboard feedback):
   * marks a single pendiente ARCA voucher as "no longer relevant" —
   * same validation/role/auth pipeline shape as periodos.controller.ts's
   * resolverPendienteArca (that endpoint's own closest precedent): voucher
   * must belong to this tenant (404), must be file_source='arca' (400), and
   * must not already be conciliado/archivado (409). See
   * comprobante-arca-archivar.ts for why "not found" and "wrong tenant" are
   * deliberately collapsed into the same 404 here (unlike the bulk endpoint
   * below).
   */
  @Post(':id/comprobantes/:voucherId/archivar')
  @HttpCode(HttpStatus.OK)
  async archivarComprobante(
    @Param('id') id: unknown,
    @Param('voucherId') voucherId: unknown,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const idFailure = validateTenantIdParam(id);
    if (idFailure) {
      throw new HttpException({ error: idFailure.error }, idFailure.status);
    }
    if (!isUuid(voucherId)) {
      throw new HttpException({ error: 'voucher id must be a UUID' }, HttpStatus.BAD_REQUEST);
    }

    const validation = validateArchivarComprobanteRequest(body);
    if (!validation.ok) {
      throw new HttpException({ error: validation.failure.error }, validation.failure.status);
    }

    const roleFailure = assertRole(req.user!, ['admin', 'colaborador']);
    if (roleFailure) {
      throw new HttpException({ error: roleFailure.error }, roleFailure.status);
    }

    const pool = getPgPool();
    const authFailure = await assertTenantAccess(pool, req.user!, id as string);
    if (authFailure) {
      throw new HttpException({ error: authFailure.error }, authFailure.status);
    }

    const result = await archivarComprobanteArca(pool, id as string, voucherId as string, validation.value.nota, req.user!.id);
    if ('code' in result) {
      throw new HttpException({ error: result.error }, result.status);
    }
    return result;
  }

  /**
   * 2026-10-12 ("Match manual" para filas `no_existe_en_arca`): la
   * contraparte exacta del endpoint anterior — usada por
   * MatchManualModal.tsx's tab "Buscar en archivados", cuando el comprobante
   * ARCA correcto para una fila `no_existe_en_arca` resulta estar en el
   * bucket de archivados (se archivó por error, o nadie lo había emparejado
   * todavía). Vuelve el voucher a `estado = 'pendiente'` para que
   * matchPeriodo pueda volver a considerarlo; el frontend SIEMPRE llama a
   * este endpoint ANTES de POST /api/periodos/:id/coincidencias — ver
   * comprobante-arca-archivar.ts's desarchivarComprobanteArca doc.
   */
  @Post(':id/comprobantes/:voucherId/desarchivar')
  @HttpCode(HttpStatus.OK)
  async desarchivarComprobante(
    @Param('id') id: unknown,
    @Param('voucherId') voucherId: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const idFailure = validateTenantIdParam(id);
    if (idFailure) {
      throw new HttpException({ error: idFailure.error }, idFailure.status);
    }
    if (!isUuid(voucherId)) {
      throw new HttpException({ error: 'voucher id must be a UUID' }, HttpStatus.BAD_REQUEST);
    }

    const roleFailure = assertRole(req.user!, ['admin', 'colaborador']);
    if (roleFailure) {
      throw new HttpException({ error: roleFailure.error }, roleFailure.status);
    }

    const pool = getPgPool();
    const authFailure = await assertTenantAccess(pool, req.user!, id as string);
    if (authFailure) {
      throw new HttpException({ error: authFailure.error }, authFailure.status);
    }

    const result = await desarchivarComprobanteArca(pool, id as string, voucherId as string, req.user!.id);
    if ('code' in result) {
      throw new HttpException({ error: result.error }, result.status);
    }
    return result;
  }

  /**
   * 2026-10-12 (Histórico filters + "Archivar"): bulk version of the
   * endpoint above — applies the same single-archive logic to each
   * `voucher_ids` entry, but reports a per-id result rather than an
   * all-or-nothing rollback (RNF-07 "nunca ocultar" — see
   * comprobante-arca-archivar.ts's own module doc).
   */
  @Post(':id/comprobantes/archivar-lote')
  @HttpCode(HttpStatus.OK)
  async archivarComprobantesLote(@Param('id') id: unknown, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const idFailure = validateTenantIdParam(id);
    if (idFailure) {
      throw new HttpException({ error: idFailure.error }, idFailure.status);
    }

    const validation = validateArchivarComprobantesLoteRequest(body);
    if (!validation.ok) {
      throw new HttpException({ error: validation.failure.error }, validation.failure.status);
    }

    const roleFailure = assertRole(req.user!, ['admin', 'colaborador']);
    if (roleFailure) {
      throw new HttpException({ error: roleFailure.error }, roleFailure.status);
    }

    const pool = getPgPool();
    const authFailure = await assertTenantAccess(pool, req.user!, id as string);
    if (authFailure) {
      throw new HttpException({ error: authFailure.error }, authFailure.status);
    }

    const result = await archivarComprobantesArcaLote(
      pool,
      id as string,
      validation.value.voucher_ids,
      validation.value.nota,
      req.user!.id,
    );
    if ('code' in result) {
      throw new HttpException({ error: result.error }, result.status);
    }
    return result;
  }

  @Put(':id/config')
  async updateConfig(@Param('id') id: unknown, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const idFailure = validateTenantIdParam(id);
    if (idFailure) {
      throw new HttpException({ error: idFailure.error }, idFailure.status);
    }

    const bodyFailure = validateUpdateTenantConfigBody(body);
    if (bodyFailure) {
      throw new HttpException({ error: bodyFailure.error }, bodyFailure.status);
    }

    const roleFailure = assertRole(req.user!, ['admin']);
    if (roleFailure) {
      throw new HttpException({ error: roleFailure.error }, roleFailure.status);
    }

    const pool = getPgPool();
    const authFailure = await assertTenantAccess(pool, req.user!, id as string);
    if (authFailure) {
      throw new HttpException({ error: authFailure.error }, authFailure.status);
    }

    const { tolerancia_redondeo_ars: tolerancia, tolerancia_dias_fecha: toleranciaDias } = body as {
      tolerancia_redondeo_ars: number;
      tolerancia_dias_fecha: number;
    };
    const { rows } = await pool.query<TenantConfigRow>(
      `UPDATE tenants SET tolerancia_redondeo_ars = $1, tolerancia_dias_fecha = $2, updated_at = now()
       WHERE id = $3
       RETURNING id, tolerancia_redondeo_ars, tolerancia_dias_fecha`,
      [tolerancia, toleranciaDias, id],
    );
    if (rows.length === 0) {
      throw new HttpException({ error: 'tenant not found' }, HttpStatus.NOT_FOUND);
    }
    return rows[0];
  }
}
