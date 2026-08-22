import { Module } from '@nestjs/common';
import { ReconciliationsModule } from './reconciliations/reconciliations.module';
import { PeriodosModule } from './periodos/periodos.module';
import { TenantsModule } from './tenants/tenants.module';

/**
 * AppModule — API root module.
 * T04 (PR-2) wires the reconciliations upload endpoint; T05+ add the
 * ingestion/matching/reporting modules as they land.
 * T18/T20 (conciliacion-periodica, PR-4) add períodos + per-tenant config.
 */
@Module({
  imports: [ReconciliationsModule, PeriodosModule, TenantsModule],
})
export class AppModule {}
