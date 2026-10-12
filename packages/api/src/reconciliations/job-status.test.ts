import { mapJobToStatusResponse } from './job-status';

/**
 * T06 — RF-04 (voucher-ingestion.spec.md). Pure unit tests for the BullMQ
 * state -> HTTP status-body mapping, independent of a live queue.
 * reconciliations.controller.test.ts covers the HTTP wiring end to end.
 */
describe('T06 RF-04: mapJobToStatusResponse', () => {
  it('maps "waiting" to pending', () => {
    expect(mapJobToStatusResponse('waiting', {})).toEqual({ status: 'pending' });
  });

  it('maps "delayed" to pending', () => {
    expect(mapJobToStatusResponse('delayed', {})).toEqual({ status: 'pending' });
  });

  it('maps "waiting-children" to pending', () => {
    expect(mapJobToStatusResponse('waiting-children', {})).toEqual({ status: 'pending' });
  });

  it('maps an unrecognized state to pending (defensive default)', () => {
    expect(mapJobToStatusResponse('unknown', {})).toEqual({ status: 'pending' });
  });

  it('maps "active" to processing', () => {
    expect(mapJobToStatusResponse('active', {})).toEqual({ status: 'processing' });
  });

  it('maps "completed" to completed with counts from returnvalue', () => {
    const job = { returnvalue: { arca_rows: 1000, contabilidad_rows: 950 } };
    expect(mapJobToStatusResponse('completed', job)).toEqual({
      status: 'completed',
      counts: { arca_rows: 1000, contabilidad_rows: 950 },
    });
  });

  it('maps "completed" with no returnvalue to completed without counts', () => {
    expect(mapJobToStatusResponse('completed', {})).toEqual({ status: 'completed' });
  });

  it('maps "failed" to error with the failure detail', () => {
    const job = { failedReason: 'corrupt row mid-stream' };
    expect(mapJobToStatusResponse('failed', job)).toEqual({
      status: 'error',
      detail: 'corrupt row mid-stream',
    });
  });

  it('maps "failed" with no failedReason to a generic error detail', () => {
    expect(mapJobToStatusResponse('failed', {})).toEqual({ status: 'error', detail: 'Unknown error' });
  });
});
