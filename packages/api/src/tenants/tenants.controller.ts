/**
 * tenants.controller.ts — T20 (RF-18): per-tenant amount tolerance
 * configuration (`tenants.tolerancia_redondeo_ars`, 014_alter_tenants_add_tolerancia.sql).
 * The client's functional spec calls for a rounding tolerance on amount
 * matching; the user chose "por tenant" over a single global value when
 * asked during the conciliacion-periodica proposal review.
 */
import { Body, Controller, Get, HttpException, HttpStatus, Param, Put, Req, UseGuards } from '@nestjs/common';
import { getPgPool } from '../db/pg-pool';
import { validateTenantIdParam, validateUpdateTenantConfigBody } from './tenants-validation';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth-guard';
import { assertTenantAccess } from '../auth/tenant-access';
import { assertRole } from '../auth/role-check';
import { fetchPendientesHistorico } from './pendientes-historico';

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
