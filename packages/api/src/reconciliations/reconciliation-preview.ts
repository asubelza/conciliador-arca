/**
 * reconciliation-preview.ts — previsualización de datos al cargar (pedido
 * del cliente, 2026-08-23, rediseño UI/UX): parsea los dos archivos de una
 * carga con el mismo adaptador/normalizador que usa el worker real
 * (`column-adapters.ts` + `comprobante-normalizer.ts` — las mismas
 * funciones que `classification-engine.ts`'s `normalizeStagedRows` llama
 * internamente), pero sin escribir nada en la base ni encolar un job. Le
 * deja al contador ver cómo se está interpretando cada archivo antes de
 * conciliar de verdad — si confirma, el frontend reenvía los mismos dos
 * archivos a `POST /api/reconciliations` (el endpoint real de carga).
 *
 * A diferencia de `normalizeStagedRows` (que separa ok/error en baldes
 * distintos, perdiendo el orden original — no importa para clasificar,
 * pero sí importaría acá), este módulo llama `adaptRow`/`normalizeRow`
 * fila por fila y arma una lista en el mismo orden del archivo, para que
 * el contador pueda comparar la previsualización contra el archivo
 * original línea por línea.
 */
import { promises as fs } from 'fs';
import { adaptRow } from './column-adapters';
import type { SourceSystem } from './column-adapters';
import { normalizeRow } from './comprobante-normalizer';
import { streamRowsFromFile } from './file-row-stream';
import type { AllowedExtension } from './upload-validation';
import type { CanonicalVoucher } from 'shared-types';

export interface PreviewRow {
  /** false cuando no se pudo resolver el tipo de comprobante AFIP (mismo camino RF-06 de "errores") — la fila igual se muestra, marcada. */
  ok: boolean;
  cuit_emisor: string;
  tipo_cbte: number;
  punto_venta: number;
  numero: number;
  fecha_emision: string;
  importe_total_ars: number;
}

export interface PreviewSide {
  total: number;
  ok: number;
  errors: number;
  rows: PreviewRow[];
}

export interface PreviewResult {
  arca: PreviewSide;
  contabilidad: PreviewSide;
}

function toPreviewRow(voucher: CanonicalVoucher, ok: boolean): PreviewRow {
  return {
    ok,
    cuit_emisor: voucher.cuit_emisor,
    tipo_cbte: voucher.tipo_cbte,
    punto_venta: voucher.punto_venta,
    numero: voucher.numero,
    fecha_emision: voucher.fecha_emision,
    importe_total_ars: voucher.importe_total_ars,
  };
}

async function buildPreviewSide(
  filePath: string,
  extension: AllowedExtension,
  fileSource: 'arca' | 'contabilidad',
  source: SourceSystem,
): Promise<PreviewSide> {
  const rows: PreviewRow[] = [];
  let ok = 0;
  let errors = 0;

  for await (const rawRow of streamRowsFromFile(filePath, extension, source)) {
    const adapted = adaptRow(source, rawRow);
    const outcome = normalizeRow(fileSource, adapted);
    rows.push(toPreviewRow(outcome.voucher, outcome.ok));
    if (outcome.ok) ok += 1;
    else errors += 1;
  }

  return { total: rows.length, ok, errors, rows };
}

/**
 * Los archivos temporales de multer se leen acá igual que en el worker
 * (`reconciliation.worker.ts`) pero nunca se pasan a `writeRowsToStaging` —
 * la previsualización es de solo lectura de punta a punta. El caller
 * (el controller) es responsable de borrar los dos archivos temporales una
 * vez que esta función termina, igual que hace el worker al final de un
 * job real.
 */
export async function buildReconciliationPreview(params: {
  arca: { filePath: string; extension: AllowedExtension };
  contabilidad: { filePath: string; extension: AllowedExtension };
  contabilidadSourceSystem: Exclude<SourceSystem, 'arca'>;
}): Promise<PreviewResult> {
  const [arca, contabilidad] = await Promise.all([
    buildPreviewSide(params.arca.filePath, params.arca.extension, 'arca', 'arca'),
    buildPreviewSide(
      params.contabilidad.filePath,
      params.contabilidad.extension,
      'contabilidad',
      params.contabilidadSourceSystem,
    ),
  ]);

  return { arca, contabilidad };
}

export async function cleanupPreviewFiles(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map(async (p) => {
      try {
        await fs.unlink(p);
      } catch {
        // Ya no existe, o nunca se creó — no es fatal para la respuesta.
      }
    }),
  );
}
