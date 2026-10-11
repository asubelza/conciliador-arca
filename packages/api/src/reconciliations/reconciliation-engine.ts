/**
 * reconciliation-engine.ts — T09 (RF-08): same-side dedupe + exact-key
 * matching between ARCA and contabilidad canonical vouchers, O(n+m).
 *
 * Tenant scoping: `CanonicalVoucher` (packages/shared-types) carries no
 * `tenant_id` — by design, tenant isolation for the Map-probe engine is
 * structural, not a runtime check inside this module: the caller only
 * ever passes one tenant's vouchers into `matchVouchers` at a time (the
 * DB read that produces these arrays is itself `WHERE tenant_id = $1`).
 * reconciliation-engine.test.ts still proves this holds under a
 * cross-tenant key collision, as a regression guard on that design
 * decision (RF-08's "tenant isolation on Map probe" scenario).
 */
import type { CanonicalVoucher } from 'shared-types';

export type CompositeKey = string;

/** `cuit_emisor|tipo_cbte|punto_venta|numero`, per reconciliation-matching.spec.md. */
export function buildCompositeKey(v: CanonicalVoucher): CompositeKey {
  return `${v.cuit_emisor}|${v.tipo_cbte}|${v.punto_venta}|${v.numero}`;
}

export interface DedupeResult {
  unique: CanonicalVoucher[];
  duplicates: CanonicalVoucher[];
}

/**
 * RF-08: within one source's own list, keep only the first occurrence of
 * each composite key; every later occurrence is a duplicate.
 */
export function dedupeBySide(vouchers: CanonicalVoucher[]): DedupeResult {
  const seen = new Map<CompositeKey, CanonicalVoucher>();
  const duplicates: CanonicalVoucher[] = [];

  for (const voucher of vouchers) {
    const key = buildCompositeKey(voucher);
    if (seen.has(key)) {
      duplicates.push(voucher);
    } else {
      seen.set(key, voucher);
    }
  }

  return { unique: [...seen.values()], duplicates };
}

export interface MatchedPair {
  arca: CanonicalVoucher;
  contabilidad: CanonicalVoucher;
}

export interface MatchResult {
  matched: MatchedPair[];
  unmatchedArca: CanonicalVoucher[];
  unmatchedContabilidad: CanonicalVoucher[];
  /** Number of Map.get() probes performed — exposed for the O(n+m) test. */
  probeCount: number;
}

/**
 * RF-08: exact composite-key match. Builds a `Map` on the smaller side and
 * probes it once per item on the larger side — O(n+m) total, and exactly
 * `max(arca.length, contabilidad.length)` probes (matching the spec's
 * "1,000 ARCA + 950 contabilidad -> exactly 1,000 probes" scenario).
 *
 * Callers should dedupe each side first (dedupeBySide) — this function
 * assumes composite keys are already unique per side and will silently let
 * a later same-side duplicate overwrite an earlier Map entry otherwise.
 */
export function matchVouchers(arca: CanonicalVoucher[], contabilidad: CanonicalVoucher[]): MatchResult {
  const arcaIsSmaller = arca.length <= contabilidad.length;
  const smaller = arcaIsSmaller ? arca : contabilidad;
  const larger = arcaIsSmaller ? contabilidad : arca;

  const smallerByKey = new Map<CompositeKey, CanonicalVoucher>();
  for (const voucher of smaller) smallerByKey.set(buildCompositeKey(voucher), voucher);

  const matched: MatchedPair[] = [];
  const unmatchedLarger: CanonicalVoucher[] = [];
  const matchedKeys = new Set<CompositeKey>();
  let probeCount = 0;

  for (const voucher of larger) {
    probeCount++;
    const key = buildCompositeKey(voucher);
    const counterpart = smallerByKey.get(key);
    if (counterpart) {
      matchedKeys.add(key);
      matched.push(arcaIsSmaller ? { arca: counterpart, contabilidad: voucher } : { arca: voucher, contabilidad: counterpart });
    } else {
      unmatchedLarger.push(voucher);
    }
  }

  const unmatchedSmaller = smaller.filter((v) => !matchedKeys.has(buildCompositeKey(v)));

  return {
    matched,
    unmatchedArca: arcaIsSmaller ? unmatchedSmaller : unmatchedLarger,
    unmatchedContabilidad: arcaIsSmaller ? unmatchedLarger : unmatchedSmaller,
    probeCount,
  };
}
