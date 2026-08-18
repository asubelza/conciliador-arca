import { Module } from '@nestjs/common';
import { ReconciliationsModule } from './reconciliations/reconciliations.module';

/**
 * AppModule — API root module.
 * T04 (PR-2) wires the reconciliations upload endpoint; T05+ add the
 * ingestion/matching/reporting modules as they land.
 */
@Module({
  imports: [ReconciliationsModule],
})
export class AppModule {}
