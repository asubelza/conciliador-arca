import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// PR-1 scaffold bootstrap. Endpoints gated by RECONCILIATION_MVP_ENABLED flag
// are added in PR-2+ (see openspec/proposal/mvp-carga-comprobantes.md rollback plan).
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}

void bootstrap();
