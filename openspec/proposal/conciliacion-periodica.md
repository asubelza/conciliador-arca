# Proposal: conciliacion-periodica

**Recibido del cliente**: 2026-08-22, como cambio de alcance sobre `mvp-carga-comprobantes` (T01–T13, completo).
**Documento funcional fuente**: `claude/spec_funcional_conciliacion_historica_2026-08-22.md` (Claude Project).
**Status**: Draft — para revisión antes de escribir specs/tareas detalladas.

## Intent

Extender la conciliación de un solo cruce efímero entre dos archivos a un flujo mensual con estado persistente: la base ARCA se acumula como "stock" de comprobantes por tenant que sobrevive entre meses, un comprobante conciliado queda bloqueado para siempre, uno pendiente sigue disponible para matchear en meses futuros, se tolera una pequeña diferencia de redondeo al comparar importes, se detectan comprobantes que la empresa vuelve a cargar por error habiendo sido ya conciliados, y el contador puede "cerrar" un mes para congelar el resultado a efectos de auditoría.

## Por qué esto es un cambio de arquitectura, no un ajuste

El MVP actual (`mvp-carga-comprobantes`) fue diseñado y verificado como: una carga = un `job` efímero de dos archivos, comparados una única vez, sin memoria de meses anteriores. Puntualmente:

- **No existe el concepto de período.** No hay tabla ni campo que agrupe cargas por mes ni que distinga "carga actual" de "histórico".
- **`vouchers_canonical` existe en el schema pero nunca se pobló** (gap ya documentado en `openspec/progress/PR-3.md`, sección "Deviations #2"). Todo el resultado de un job vive en `reconciliation_results` con el JSON completo embebido, sin una fila persistente por comprobante que pueda cambiar de estado en un job futuro.
- **El motor de matching (`reconciliation-engine.ts`) es de un solo paso**: arma un `Map` con las dos listas del job actual y las cruza. No hay lugar hoy para "excluir lo ya conciliado" ni "buscar en pendientes de meses anteriores", porque no hay ningún dato que persista más allá de un job.
- **La clasificación es por igualdad exacta de clave compuesta**, sin comparación de montos — no hay tolerancia ni estado "con divergencia".
- **No hay ninguna acción de cierre** ni nada que se congele; un job simplemente termina y sus resultados quedan ahí.

Por eso esto se trata como una propuesta nueva (mismo proceso que se usó para el MVP: proposal → arquitectura → specs → tareas), no como una tarea suelta sobre el código existente.

## Decisiones ya acordadas con el usuario (2026-08-22)

- **Un período puede recibir varias cargas.** No es "una carga = un período": mientras un período está abierto, el par de archivos (ARCA + Sistema) se puede volver a subir (cargas parciales, correcciones). Recién "Cerrar Mes" consolida el resultado final de ese período.
- **La tolerancia de redondeo es configurable por tenant**, no un valor único global del sistema — consistente con que todo lo demás en este sistema ya está scoped por `tenant_id`.

## Scope

### In Scope
- Concepto de **período** (mes) por tenant: crear, subir archivos (múltiples veces mientras está abierto), consultar estado, cerrar.
- Poblar y usar de verdad `vouchers_canonical` como stock persistente, con estado `pendiente` / `conciliado` por comprobante.
- Algoritmo de match en 3 pasos: (1) excluir del pool de búsqueda todo lo ya `conciliado` en meses anteriores, (2) match corriente (Sistema del período N contra ARCA cargado en el período N), (3) match histórico (lo que no matcheó en el paso 2, contra stock ARCA `pendiente` de períodos anteriores).
- Comparación de Importe Total / Netos / IVA con tolerancia configurable por tenant (default ±$0,99); nueva clasificación `con_divergencia` cuando la diferencia excede la tolerancia.
- Detección de `posible_duplicado_en_sistema`: un comprobante cargado en Sistema cuya clave compuesta ya está `conciliado` (de un período anterior).
- Acción **"Cerrar Conciliación del Mes"**: persiste el estado final (`conciliado`/`pendiente`) de cada comprobante del período, hace *rollover* del stock ARCA no matcheado hacia los períodos siguientes, y congela una foto de los resultados del período para auditoría (inmutable después del cierre, igual que `audit_trail` hoy).
- Reporte de 3 secciones: Conciliados OK / Discrepancias y Alertas (no existe en ARCA + con divergencia + posible duplicado) / Pendientes en ARCA (con antigüedad = hace cuántos meses está pendiente).
- Configuración de tolerancia por tenant (valor y quién puede cambiarlo).

### Out of Scope (esta iteración — a definir aparte si hace falta)
- Reabrir un período ya cerrado.
- Editar manualmente un comprobante ya conciliado.
- Notificaciones automáticas (email/alertas) por comprobantes pendientes viejos — el reporte muestra la antigüedad, pero no hay disparo automático.
- Multi-moneda / cotización — se mantiene el supuesto actual de solo ARS.
- Todo lo que ya estaba fuera de alcance del MVP original (login real con roles, fetch automático a ARCA vía web service, portal para el cliente final) sigue fuera de alcance acá también.

## Capabilities

### New Capabilities
- **`periodos`**: alta/consulta de períodos de conciliación por tenant, con estado `abierto`/`cerrado`.
- **`stock-historico-comprobantes`**: `vouchers_canonical` poblada de verdad, con estado persistente por comprobante.
- **`matching-periodico`**: motor de 3 pasos contra stock persistente + tolerancia + detección de duplicado.
- **`cierre-de-mes`**: acción que congela el período, persiste estados finales, y hace rollover del stock pendiente.

### Modified Capabilities
- **`reconciliation-matching`** (existente, `openspec/specs/mvp-carga-comprobantes/reconciliation-matching.spec.md`): el engine O(n+m) actual es la base algorítmica, pero cambia radicalmente qué conjuntos arma y compara — dos listas efímeras hoy, tres fuentes (corriente ARCA, corriente Sistema, stock pendiente histórico) mañana.
- **`reconciliation-reporting`** (existente): nueva estructura de 3 secciones en lugar de las 4 hojas actuales (Matched/Unmatched ARCA/Unmatched Contabilidad/Errors); se mantiene CSV/XLSX como formatos.
- **`voucher-ingestion`** (existente): una carga deja de estar asociada solo a un `job_id` aislado — pasa a estar asociada también a un `período_id`, y un período admite más de una carga.

## Task Breakdown Estimate (borrador — el desglose fino queda para las tareas, después de aprobar esta propuesta y la arquitectura)

| # | Tarea | Esfuerzo |
|---|-------|----------|
| 1 | Migraciones: tabla `periodos`, tolerancia por tenant, columnas de estado/período en `vouchers_canonical` | M |
| 2 | Endpoints de período: crear, listar, consultar estado, cerrar | S |
| 3 | Upload: asociar cada carga a un `período_id`; permitir múltiples cargas por período abierto | M |
| 4 | Poblar `vouchers_canonical` de verdad (upsert por clave compuesta y lado ARCA/Sistema) desde el staging existente | M |
| 5 | Motor de matching de 3 pasos contra stock persistente | L |
| 6 | Comparación de importes con tolerancia por tenant + clasificación `con_divergencia` | S |
| 7 | Detección de `posible_duplicado_en_sistema` | S |
| 8 | "Cerrar Conciliación del Mes": freeze + rollover de pendientes + snapshot inmutable | M |
| 9 | Reporte de 3 secciones (con antigüedad en Pendientes en ARCA) | M |
| 10 | Frontend: selector/alta de período, cargas múltiples, botón Cerrar Mes, nuevo reporte | M |
| 11 | Configuración de tolerancia por tenant (endpoint + UI simple) | S |

Ver `openspec/designs/conciliacion-periodica/architecture.md` para el detalle técnico (schema, algoritmo, API) que sustenta esta estimación.

## Preguntas abiertas para la revisión (antes de pasar a specs/tareas)

1. **¿"Cerrar mes" es estrictamente irreversible**, o hace falta poder reabrir un período cerrado en algún caso excepcional (ej: error del contador)? La spec funcional dice "congela la foto para auditoría", lo que sugiere irreversible — arquitectura asume esto salvo que se indique lo contrario.
2. **Cuando dentro de un mismo período se vuelve a subir el mismo archivo** (ej: ARCA corregido), ¿la carga nueva reemplaza por completo a la anterior, o se mergean por clave compuesta (la carga más reciente gana si hay conflicto en la misma clave)? Arquitectura asume merge por clave, última carga gana, salvo indicación contraria.
3. **Los datos que ya existen hoy en producción** (jobs sin período, corridos bajo el modelo actual) — ¿se migran a un período "histórico" inicial, o el modelo nuevo aplica solo hacia adelante y lo viejo queda como está (visible solo por job_id, no por período)?
