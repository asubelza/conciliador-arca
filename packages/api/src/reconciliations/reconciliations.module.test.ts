/**
 * reconciliations.module.test.ts — basic construction/wiring test for the
 * NestJS module (previously zero test coverage — PR review finding #7).
 * Only proves the DI container builds and registers the controller; the
 * controller's own HTTP behavior is covered by reconciliations.controller.test.ts.
 */
import { Test } from '@nestjs/testing';
import { ReconciliationsModule } from './reconciliations.module';
import { ReconciliationsController } from './reconciliations.controller';

describe('ReconciliationsModule', () => {
  it('compiles and registers ReconciliationsController', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ReconciliationsModule],
    }).compile();

    const controller = moduleRef.get(ReconciliationsController);
    expect(controller).toBeInstanceOf(ReconciliationsController);

    await moduleRef.close();
  });
});
