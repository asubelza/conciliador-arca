import { Module } from '@nestjs/common';
import { ReconciliationsModule } from './reconciliations/reconciliations.module';
import { PeriodosModule } from './periodos/periodos.module';
import { TenantsModule } from './tenants/tenants.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './auth/users.module';
import { PlatformModule } from './platform/platform.module';

/**
 * AppModule — API root module.
 * T04 (PR-2) wires the reconciliations upload endpoint; T05+ add the
 * ingestion/matching/reporting modules as they land.
 * T18/T20 (conciliacion-periodica, PR-4) add períodos + per-tenant config.
 * T35/T36 (autenticacion-roles, Fase 1) add login/AuthGuard — existing
 * modules aren't protected yet, that's Fase 2 (T37-T39).
 * Backoffice self-service (invitación por email) adds UsersModule
 * (admin-only user CRUD, separate module from AuthModule's
 * login/me/accept-invite — different resource, kept apart the same way
 * TenantsModule is its own module).
 * Multi-estudio pivot (PR6/8) adds PlatformModule — platform-level staff's
 * own estudio CRUD + invite-admin, a separate domain from UsersModule
 * (which manages users WITHIN one estudio, not estudios themselves).
 */
@Module({
  imports: [ReconciliationsModule, PeriodosModule, TenantsModule, AuthModule, UsersModule, PlatformModule],
})
export class AppModule {}
