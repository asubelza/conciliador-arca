# Design: conciliacion-periodica

**Proposal**: openspec/proposal/conciliacion-periodica.md
**Status**: Draft — para revisión antes de escribir specs/tareas detalladas.

## Prerrequisito real encontrado al diseñar esto: dos esquemas de `tipo_cbte` incompatibles conviven hoy

Antes de poder poblar `vouchers_canonical` de verdad (columna vertebral de todo este cambio, porque es donde vive el estado persistente `pendiente`/`conciliado`), hay que resolver algo que ya estaba señalado pero nunca bloqueó nada porque nadie usaba esa tabla: **el sistema tiene hoy dos codificaciones distintas de "tipo de comprobante" que nunca se conectaron entre sí.**

- **La que usa todo el pipeline real** (`column-adapters.ts`, `afip-tipo-lookup.ts`, `comprobante-normalizer.ts`, `CanonicalVoucher.tipo_cbte` en `shared-types`): los códigos AFIP reales de la "Tabla de Comprobantes" — enteros como `1` (Factura A), `6` (Factura B), `11` (Factura C), `3`/`8`/`13` (Notas de Crédito), etc. Esto es lo que de verdad se calcula al normalizar cada fila, y es lo que el motor de matching compara hoy.
- **La que tiene el schema de `vouchers_canonical`/`afip_tipo_map`** (migraciones 002 y 004, de T01/T02, escritas antes de que existiera ningún adaptador real): un código de texto de 3 dígitos con ceros a la izquierda (`'001'`, `'003'`, `'004'`, …), con una lista de 15 valores que ni siquiera separa Factura A/B/C de la misma forma. `vouchers_canonical.tipo` tiene una FK a `afip_tipo_map.tipo` usando este esquema viejo.

Como nunca se pobló `vouchers_canonical` (gap ya documentado en PR-3), este desacople nunca causó un error — pero ahora que este módulo necesita esa tabla como stock persistente real, hay que resolverlo primero. La solución propuesta es migrar `afip_tipo_map`/`vouchers_canonical.tipo` al esquema entero real de AFIP (el mismo que ya usa todo el pipeline vivo), no al revés — porque ese es el que está probado contra datos reales (incluyendo el adaptador `libro_iva_compras` agregado ayer). Esto implica:

- Nueva migración: `afip_tipo_map` pasa de `tipo CHAR(3)` a `codigo INTEGER` con los códigos reales (1,2,3,6,7,8,11,12,13,19,20,21 — los mismos que `afip-tipo-lookup.ts` ya reconoce).
- `vouchers_canonical.tipo` pasa a `tipo_cbte INTEGER REFERENCES afip_tipo_map(codigo)`.
- `shared-types`: `AFIP_TIPOS_CADENCIAL`/`AFIP_TIPO_LABELS` se actualizan al esquema entero (o se agrega un segundo catálogo si `seed.ts`/`seed-runner.ts` necesitan mantenerse compatibles — a decidir en la tarea concreta).
- `seed.ts` se re-escribe para sembrar los códigos reales.

Esto se trata como **Tarea 0** de esta propuesta: sin resolverlo, no hay forma honesta de poblar `vouchers_canonical`.

## Technical Approach

El motor de matching actual (`reconciliation-engine.ts`, `Map`-probe O(n+m)) se mantiene como base algorítmica, pero pasa de comparar dos listas efímeras de un job a comparar contra un stock persistente por tenant:

1. Cada carga (upload) se asocia a un `período_id` (mes calendario, por tenant), no solo a un `job_id` aislado como hoy. Un período admite múltiples cargas mientras está `abierto`.
2. Cada carga sigue pasando por `vouchers_staging` (sin cambios) y normalización (`column-adapters.ts`/`comprobante-normalizer.ts`, sin cambios) — pero ahora el resultado normalizado se **upsertea** en `vouchers_canonical` por clave compuesta `(tenant_id, cuit_emisor, tipo_cbte, punto_venta, numero, file_source)`, no se descarta después del job.
3. El matching de un período corre en 3 pasos contra ese stock (detalle en "Algoritmo de Matching" abajo), compara importes con tolerancia por tenant, y clasifica en las nuevas categorías.
4. "Cerrar Mes" persiste el estado final (`conciliado`/`pendiente`) de cada fila de `vouchers_canonical` tocada en el período, y congela una foto inmutable de `reconciliation_results` para ese período (mismo patrón append-only que ya existe para `audit_trail`).

## Modelo de Estados de un Comprobante ARCA

```
                    ┌─────────────┐
   (se carga vía    │  pendiente  │◀──────────────┐
    upload ARCA) ──▶│             │                │ rollover al
                    └──────┬──────┘                │ cerrar mes si
                           │                        │ sigue sin match
                           │ match encontrado        │
                           │ (corriente o histórico) │
                           ▼                        │
                    ┌─────────────┐                 │
                    │ matcheado   │──── Cerrar Mes ──┘ (si NO matcheó)
                    │ (pendiente  │
                    │ de cierre)  │
                    └──────┬──────┘
                           │ Cerrar Mes
                           ▼
                    ┌─────────────┐
                    │ conciliado  │  ← terminal, inmutable
                    └─────────────┘
```

Un comprobante Sistema (lado empresa) no tiene este mismo ciclo de vida — se compara contra el stock ARCA en cada corrida del período, pero no "persiste" como stock propio del mismo modo (no hay "Sistema pendiente"; lo que persiste como stock reutilizable entre meses es solo el lado ARCA, según la spec funcional: "Pasa los comprobantes **no matcheados de ARCA** al Stock de Pendientes").

## Algoritmo de Matching (3 pasos)

Corre cada vez que se sube un archivo dentro de un período abierto (recalcula sobre el estado actual del período, no acumula incrementalmente — ver Pregunta Abierta #2 del proposal).

```
entrada: tenant_id, período_id
  sistema_rows = todas las filas Sistema cargadas en este período (todas las cargas, merged por clave, última gana)
  arca_corriente = filas ARCA cargadas en este período
  arca_pendiente_historico = SELECT * FROM vouchers_canonical
                              WHERE tenant_id = :tenant_id
                                AND file_source = 'arca'
                                AND estado = 'pendiente'
                                AND período_alta_id <> :período_id   -- de meses anteriores

  # Paso 1: Filtro de Exclusión (implícito)
  # arca_pendiente_historico y arca_corriente por construcción NUNCA incluyen
  # filas con estado 'conciliado' — la exclusión es el WHERE de arriba, no un
  # paso de filtrado aparte.

  para cada fila de sistema_rows:
    match = buscar en arca_corriente por clave compuesta         # Paso 2: Match Corriente
    si no hay match:
      match = buscar en arca_pendiente_historico por clave       # Paso 3: Match Histórico

    si match encontrado:
      diff = comparar importe_total (y netos/IVA) dentro de tolerancia_tenant
      si diff dentro de tolerancia:
        clasificar 'conciliado_ok'   (candidato — se confirma recién al Cerrar Mes)
      si no:
        clasificar 'con_divergencia'
    si NO hay match:
      ya_conciliado = existe en vouchers_canonical con esta clave Y estado = 'conciliado' (cualquier período)
      si ya_conciliado:
        clasificar 'posible_duplicado_en_sistema'
      si no:
        clasificar 'no_existe_en_arca'   (Discrepancia)

  # Lo que queda de arca_corriente + arca_pendiente_historico sin marcar como
  # match de ningún sistema_row es candidato a 'pendiente_en_arca' (sección 3
  # del reporte), con antigüedad = mes_actual - período_alta_id del comprobante.
```

Nota de complejidad: sigue siendo O(n+m) por período — el stock histórico pendiente se indexa igual que hoy (`idx_vouchers_tenant_key`), no cambia el enfoque de `Map`-probe, solo la cantidad de fuentes que se combinan antes de armar el `Map`.

## Cambios de Schema (borrador de migraciones)

```sql
-- 012_migrate_tipo_to_afip_integer_codes.sql  (Tarea 0 — ver arriba)
-- Reemplaza el CHAR(3) legacy por los códigos AFIP reales enteros que ya
-- usa afip-tipo-lookup.ts. Rompe el contenido actual de afip_tipo_map (que
-- de todos modos no tiene FKs poblados desde ningún lado real todavía).
ALTER TABLE afip_tipo_map RENAME TO afip_tipo_map_legacy;   -- o DROP, a decidir
CREATE TABLE afip_tipo_map (
  codigo      INTEGER PRIMARY KEY,     -- 1, 2, 3, 6, 7, 8, 11, 12, 13, 19, 20, 21, ...
  descripcion TEXT NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT TRUE
);
-- vouchers_canonical.tipo (CHAR(3)) -> tipo_cbte (INTEGER REFERENCES afip_tipo_map(codigo))

-- 013_init_periodos.sql
CREATE TABLE periodos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  mes               DATE NOT NULL,              -- normalizado al día 1 del mes, ej '2026-04-01'
  estado            TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado')),
  tolerancia_ars    NUMERIC(10,2),               -- snapshot de la tolerancia del tenant AL CERRAR (auditable)
  cerrado_at        TIMESTAMPTZ,
  cerrado_por       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, mes)
);
CREATE INDEX idx_periodos_tenant_estado ON periodos (tenant_id, estado);

-- 014_alter_tenants_add_tolerancia.sql
ALTER TABLE tenants ADD COLUMN tolerancia_redondeo_ars NUMERIC(10,2) NOT NULL DEFAULT 0.99;

-- 015_alter_vouchers_canonical_add_estado_periodo.sql
ALTER TABLE vouchers_canonical
  ADD COLUMN estado            TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'conciliado')),
  ADD COLUMN periodo_alta_id   UUID REFERENCES periodos(id),      -- período en que se cargó por primera vez
  ADD COLUMN periodo_cierre_id UUID REFERENCES periodos(id);      -- período en que se marcó 'conciliado' (nullable)
CREATE UNIQUE INDEX idx_vouchers_tenant_key_unique
  ON vouchers_canonical (tenant_id, file_source, cuit_emisor, tipo_cbte, punto_venta, numero);
CREATE INDEX idx_vouchers_tenant_estado ON vouchers_canonical (tenant_id, file_source, estado);

-- 016_alter_reconciliation_results_add_periodo.sql
ALTER TABLE reconciliation_results ADD COLUMN periodo_id UUID REFERENCES periodos(id);
CREATE INDEX idx_recon_periodo ON reconciliation_results (periodo_id);
-- tipo_clasificacion gana 3 valores nuevos: 'con_divergencia',
-- 'posible_duplicado_en_sistema', 'pendiente_en_arca' — coexisten con los 5
-- existentes por compatibilidad hacia atrás con jobs viejos sin período.
```

## Cambios de API (borrador)

```
POST   /api/periodos                     crear período (tenant_id, mes) -> 201, o 409 si ya existe ese mes
GET    /api/periodos?tenant_id=...       listar períodos de un tenant (con estado)
GET    /api/periodos/:id                 detalle + resumen de conteos actuales
POST   /api/periodos/:id/cerrar          Cerrar Conciliación del Mes -> 200, o 409 si ya estaba cerrado

POST   /api/reconciliations              (existente) — gana un campo requerido `periodo_id`;
                                          400 si el período está 'cerrado'

GET    /api/periodos/:id/report?format=csv|xlsx|json   reporte de 3 secciones para ese período

GET    /api/tenants/:id/config           incluye tolerancia_redondeo_ars
PUT    /api/tenants/:id/config           actualizar tolerancia_redondeo_ars
```

## Reporte de 3 secciones

Reemplaza las 4 hojas actuales (Matched/Unmatched ARCA/Unmatched Contabilidad/Errors):

1. **Conciliados OK** — `tipo_clasificacion = 'conciliado_ok'` (o, tras el cierre, comprobantes que quedaron `estado = 'conciliado'` en este período).
2. **Discrepancias y Alertas** — unión de `no_existe_en_arca`, `con_divergencia`, `posible_duplicado_en_sistema`. Cada fila indica cuál de los tres es, para que el contador filtre.
3. **Pendientes en ARCA** — comprobantes ARCA `estado = 'pendiente'` visibles en este período (corrientes + histórico no matcheado), con columna `antiguedad_meses` calculada contra `periodo_alta_id`.

`errors` (fila que no pudo normalizarse, `tipo_cbte` desconocido) se mantiene como categoría técnica aparte, no como parte de las 3 secciones de negocio — igual que hoy, no es algo que el contador deba "resolver" en el mismo sentido que una discrepancia real.

## Testing Strategy

Mismo enfoque que el resto del proyecto — nada de esto se da por andando sin correrlo contra Postgres/Redis reales:

| Capa | Qué | Cómo |
|------|-----|------|
| Unit | Migración de esquema de tipos (Tarea 0) | Verificar contra los códigos reales que `afip-tipo-lookup.ts` ya reconoce, no re-inventar la lista |
| Unit | Algoritmo de 3 pasos | Casos con stock histórico pendiente real de 2+ períodos simulados, incluyendo el caso "match corriente encontrado, no debe ni mirar histórico" |
| Unit | Tolerancia | Diferencia exactamente en el borde (`$0.99`/`$1.00`) por tenant, dos tenants con tolerancias distintas en la misma corrida |
| Unit | Duplicado | Comprobante Sistema que matchea clave de uno YA conciliado en período anterior |
| Integración (Postgres real) | Ciclo completo: abrir período → cargar (2 veces) → cerrar → abrir período siguiente → verificar rollover de pendientes | Contra Postgres real en el sandbox de esta sesión, igual que T10-T13 |
| Integración | Período cerrado rechaza nuevas cargas (409) | — |
| Integración | Reporte de 3 secciones con antigüedad correcta | — |

## Open Questions (técnicas, además de las 3 del proposal)

- ¿Qué pasa si dos cargas del mismo período traen el mismo comprobante ARCA con importes distintos (ej: corrección real del proveedor)? ¿Upsert silencioso (última gana) o hay que dejar rastro de que cambió?
- El campo `iva`/netos por tolerancia: ¿la tolerancia aplica solo a `importe_total`, o también a IVA/Neto por separado? La spec dice "compara Importe Total e IVA/Netos" pero no aclara si la tolerancia es una por cada campo o solo sobre el total.
- ¿"Pendientes en ARCA" con mucha antigüedad necesita algún tope (ej: dejar de mostrar/alertar después de N meses) o se acumula indefinidamente?
