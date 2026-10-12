/**
 * reconciliation.worker.main.test.ts — construction/wiring test for the
 * standalone BullMQ worker process entrypoint (previously zero test
 * coverage — PR review finding #7).
 *
 * `main()` runs at module-import time (see reconciliation.worker.main.ts's
 * bottom-of-file `main();` call), so this test mocks its two dependencies
 * (the shared pg pool and the worker factory) before requiring the module,
 * then asserts the wiring: the pool comes from the shared `getPgPool()`
 * (finding #6 — no more `new Pool(...)` constructed directly here), and
 * the 'completed'/'failed' handlers are registered on the worker it builds.
 */
describe('reconciliation.worker.main', () => {
  it('builds its worker from the shared pg pool and registers completed/failed handlers', () => {
    jest.resetModules();

    const fakePool = { fake: 'pool' };
    const getPgPool = jest.fn(() => fakePool);
    jest.doMock('../db/pg-pool', () => ({ getPgPool }));

    const fakeWorker = { on: jest.fn() };
    const createReconciliationWorker = jest.fn(() => fakeWorker);
    jest.doMock('./reconciliation.worker', () => ({ createReconciliationWorker }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./reconciliation.worker.main');

    expect(getPgPool).toHaveBeenCalledTimes(1);
    expect(createReconciliationWorker).toHaveBeenCalledWith(fakePool);
    expect(fakeWorker.on).toHaveBeenCalledWith('completed', expect.any(Function));
    expect(fakeWorker.on).toHaveBeenCalledWith('failed', expect.any(Function));

    jest.dontMock('../db/pg-pool');
    jest.dontMock('./reconciliation.worker');
    jest.resetModules();
  });
});
