import { Module } from '@nestjs/common';
import { ReconciliationsController } from './reconciliations.controller';

@Module({
  controllers: [ReconciliationsController],
})
export class ReconciliationsModule {}
