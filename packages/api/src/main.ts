import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// PR-1 scaffold bootstrap. Endpoints gated by RECONCILIATION_MVP_ENABLED flag
// are added in PR-2+ (see openspec/proposal/mvp-carga-comprobantes.md rollback plan).
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // T13: packages/web (Next.js, its own origin/port) calls this API directly
  // from the browser. No allowlist config exists yet (same documented gap
  // as auth — see upload-validation.ts's validateTenantId comment), so this
  // reflects the request origin for local/MVP use; a real origin allowlist
  // is a deploy concern for later.
  app.enableCors();
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}

void bootstrap();
