/**
 * classification-engine.ts — T10 (RF-09): ties T07 (adapters/tipo lookup),
 * T08 (normalization) and T09 (dedupe/match) together into the 5-category
 * classification, and applies RF-09's IVA-descending sort to the unmatched
 * categories.
 */
import { adaptRow } from './column-adapters';
import type { SourceSystem } from './column-adapters';
import { normalizeRow } from './comprobante-normalizer';
import { buildCompositeKey, dedupeBySide, matchVouchers } from './reconciliation-engine';
import { Classification } from 'shared-types';
import type { CanonicalVoucher } from 'shared-types';
import type { RawRow } from './file-row-stream';

export interface ClassifiedResult {
  classification: Classification;
  composite_key: string;
  arca?: CanonicalVoucher;
  contabilidad?: CanonicalVoucher;
  iva_amount: number;
}

export type ClassificationCounts = Record<Classification, number>;

export interface ClassificationSummary {
  results: ClassifiedResult[];
  counts: ClassificationCounts;
}

function sideOf(voucher: CanonicalVoucher): 'arca' | 'contabilidad' {
  return voucher.file_source;
}

/**
 * Runs the full pipeline for one reconciliation job: raw staged rows for
 * both files -> adapt -> normalize -> classifyVouchers (dedupe/match/sort).
 *
 * `contabilidadSourceSystem` selects which vendor's column adapter to use
 * for the contabilidad file (ARCA's adapter is always used for the arca
 * file) — see reconciliations.controller.ts, which now requires this as a
 * request field.
 */
export function classifyStagedRows(
  arcaRawRows: RawRow[],
  contabilidadRawRows: RawRow[],
  contabilidadSourceSystem: Exclude<SourceSystem, 'arca'>,
): ClassificationSummary {
  const arcaNormalized = arcaRawRows.map((row) => normalizeRow('arca', adaptRow('arca', row)));
  const contabilidadNormalized = contabilidadRawRows.map((row) =>
    normalizeRow('contabilidad', adaptRow(contabilidadSourceSystem, row)),
  );

  const arcaErrors = arcaNormalized.filter((n) => !n.ok).map((n) => n.voucher);
  const contabilidadErrors = contabilidadNormalized.filter((n) => !n.ok).map((n) => n.voucher);
  const arcaOk = arcaNormalized.filter((n) => n.ok).map((n) => n.voucher);
  const contabilidadOk = contabilidadNormalized.filter((n) => n.ok).map((n) => n.voucher);

  return classifyVouchers(arcaOk, contabilidadOk, arcaErrors, contabilidadErrors);
}

/**
 * Lower-level entry point operating directly on already-normalized
 * `CanonicalVoucher`s (bypassing raw-row adaptation) — exported so the
 * dedupe/match/classify/sort logic, including RF-09's IVA-descending sort,
 * is unit-testable with synthetic `iva` values independent of the upstream
 * adapters (no adapter can populate a real `iva` yet — see
 * comprobante-normalizer.ts's documented gap).
 */
export function classifyVouchers(
  arcaOk: CanonicalVoucher[],
  contabilidadOk: CanonicalVoucher[],
  arcaErrors: CanonicalVoucher[] = [],
  contabilidadErrors: CanonicalVoucher[] = [],
): ClassificationSummary {
  const arcaDedup = dedupeBySide(arcaOk);
  const contabilidadDedup = dedupeBySide(contabilidadOk);

  const matchResult = matchVouchers(arcaDedup.unique, contabilidadDedup.unique);

  const results: ClassifiedResult[] = [];

  for (const pair of matchResult.matched) {
    results.push({
      classification: Classification.Matched,
      composite_key: buildCompositeKey(pair.arca),
      arca: pair.arca,
      contabilidad: pair.contabilidad,
      iva_amount: pair.arca.iva || pair.contabilidad.iva || 0,
    });
  }

  const unmatched: ClassifiedResult[] = [
    ...matchResult.unmatchedArca.map((v) => ({
      classification: Classification.UnmatchedArca,
      composite_key: buildCompositeKey(v),
      arca: v,
      iva_amount: v.iva,
    })),
    ...matchResult.unmatchedContabilidad.map((v) => ({
      classification: Classification.UnmatchedContabilidad,
      composite_key: buildCompositeKey(v),
      contabilidad: v,
      iva_amount: v.iva,
    })),
  ];
  // RF-09: unmatched vouchers sorted by iva_amount DESC so the accountant
  // reviews the highest-impact gaps first.
  unmatched.sort((a, b) => b.iva_amount - a.iva_amount);

  const duplicates = [...arcaDedup.duplicates, ...contabilidadDedup.duplicates].map((v) => ({
    classification: Classification.Duplicates,
    composite_key: buildCompositeKey(v),
    [sideOf(v)]: v,
    iva_amount: v.iva,
  })) as ClassifiedResult[];

  const errors = [...arcaErrors, ...contabilidadErrors].map((v) => ({
    classification: Classification.Errors,
    composite_key: buildCompositeKey(v),
    [sideOf(v)]: v,
    iva_amount: v.iva,
  })) as ClassifiedResult[];

  results.push(...unmatched, ...duplicates, ...errors);

  const counts: ClassificationCounts = {
    [Classification.Matched]: matchResult.matched.length,
    [Classification.UnmatchedArca]: matchResult.unmatchedArca.length,
    [Classification.UnmatchedContabilidad]: matchResult.unmatchedContabilidad.length,
    [Classification.Duplicates]: duplicates.length,
    [Classification.Errors]: errors.length,
  };

  return { results, counts };
}
