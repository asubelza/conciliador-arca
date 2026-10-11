import { Module } from '@nestjs/common';
import { PeriodosController } from './periodos.controller';

@Module({
  controllers: [PeriodosController],
})
export class PeriodosModule {}
