/**
 * tenants.controller.ts — T20 (RF-18): per-tenant amount tolerance
 * configuration (`tenants.tolerancia_redondeo_ars`, 014_alter_tenants_add_tolerancia.sql).
 * The client's functional spec calls for a rounding tolerance on amount
 * matching; the user chose "por tenant" over a single global value when
 * asked during the conciliacion-periodica proposal review.
 */
import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { getPgPool } from '../db/pg-pool';
import { isUuid, validateTenantIdParam, validateUpdateTenantConfigBody } from './tenants-validation';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth-guard';
import { assertTenantAccess } from '../auth/tenant-access';
import { assertRole } from '../auth/role-check';
import { fetchPendientesHistorico } from './pendientes-historico';
import { validateComprobanteArcaManualRequest } from './comprobante-arca-manual-validation';
import { createComprobanteArcaManual } from './comprobante-arca-manual';
import {
  validateArchivarComprobanteRequest,
  validateArchivarComprobantesLoteRequest,
} from './comprobante-arca-archivar-validation';
import { archivarComprobanteArca, archivarComprobantesArcaLote, desarchivarComprobanteArca } from './comprobante-arca-archivar';

export interface TenantConfigRow {
  id: string;
  tolerancia_redondeo_ars: string;
  tolerancia_dias_fecha: number;
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
