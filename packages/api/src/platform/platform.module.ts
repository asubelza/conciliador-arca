import { Module } from '@nestjs/common';
import { EstudiosController } from './estudios.controller';

@Module({
  controllers: [EstudiosController],
})
export class PlatformModule {}
