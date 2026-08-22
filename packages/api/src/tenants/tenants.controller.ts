/**
 * tenants.controller.ts — T20 (RF-18): per-tenant amount tolerance
 * configuration (`tenants.tolerancia_redondeo_ars`, 014_alter_tenants_add_tolerancia.sql).
 * The client's functional spec calls for a rounding tolerance on amount
 * matching; the user chose "por tenant" over a single global value when
 * asked during the conciliacion-periodica proposal review.
 */
import { Body, Controller, Get, HttpException, HttpStatus, Param, Put } from '@nestjs/common';
import { getPgPool } from '../db/pg-pool';
import { validateTenantIdParam, validateUpdateTenantConfigBody } from './tenants-validation';

export interface TenantConfigRow {
  id: string;
  tolerancia_redondeo_ars: string;
}

@Controller('api/tenants')
export class TenantsController {
  @Get(':id/config')
  async getConfig(@Param('id') id: unknown) {
    const failure = validateTenantIdParam(id);
    if (failure) {
      throw new HttpException({ error: failure.error }, failure.status);
    }

    const pool = getPgPool();
    const { rows } = await pool.query<TenantConfigRow>(
      'SELECT id, tolerancia_redondeo_ars FROM tenants WHERE id = $1',
      [id],
    );
    if (rows.length === 0) {
      throw new HttpException({ error: 'tenant not found' }, HttpStatus.NOT_FOUND);
    }
    return rows[0];
  }

  @Put(':id/config')
  async updateConfig(@Param('id') id: unknown, @Body() body: unknown) {
    const idFailure = validateTenantIdParam(id);
    if (idFailure) {
      throw new HttpException({ error: idFailure.error }, idFailure.status);
    }

    const bodyFailure = validateUpdateTenantConfigBody(body);
    if (bodyFailure) {
      throw new HttpException({ error: bodyFailure.error }, bodyFailure.status);
    }

    const { tolerancia_redondeo_ars: tolerancia } = body as { tolerancia_redondeo_ars: number };
    const pool = getPgPool();
    const { rows } = await pool.query<TenantConfigRow>(
      `UPDATE tenants SET tolerancia_redondeo_ars = $1, updated_at = now()
       WHERE id = $2
       RETURNING id, tolerancia_redondeo_ars`,
      [tolerancia, id],
    );
    if (rows.length === 0) {
      throw new HttpException({ error: 'tenant not found' }, HttpStatus.NOT_FOUND);
    }
    return rows[0];
  }
}
