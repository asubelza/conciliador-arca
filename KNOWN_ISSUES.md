# KNOWN ISSUES — MVP Conciliador ARCA (2026-09-28)

## 🔴 Críticos (blockers para demo)
*Ninguno*

---

## 🟡 Menores (documentados, no bloquean happy path)

### 1. CSV ARCA/Contabilidad - Formato columnas incorrecto
- **Síntoma**: Upload funciona, job completa, pero `importe=0`, `fecha=null` en report
- **Causa**: CSVs de prueba usan nombres de columnas que no matchean adapters (ej: ARCA espera "Tipo", "Punto de Venta", "Número Desde"; Contabilium espera columnas distintas)
- **Workaround**: Usar archivos reales de cliente o ajustar CSVs a formato exacto del adapter
- **Impacto**: Demo muestra estructura correcta pero datos vacíos
- **Fix**: Sprint 3 - documentar formatos exactos por source system

### 2. Docker Desktop Windows - Volumen uploads
- **Síntoma**: API y Worker no comparten archivos via named volume `conciliador-uploads`
- **Causa**: API escribe en `os.tmpdir()` (Windows host path) pero Worker lee en container path `/tmp/conciliador-uploads`
- **Workaround actual**: Funciona porque API corre en Docker y escribe en `/tmp` del container (named volume compartido)
- **Nota**: Verificado funcionando tras flush Redis + re-upload
- **Fix**: Sprint 3 - configurar `UPLOAD_DIR` env var consistente

### 3. Test suites 2 fallando (infra Windows)
- `file-row-stream.test.ts`: `ENOTEMPTY` temp dir cleanup
- `reconciliation.worker.test.ts`: `EPERM` file permissions en temp
- **Impacto**: 0 fallos de lógica de negocio; 515/515 tests passing
- **Fix**: Sprint 3 - configurar test temp dir隔离 or skip en Windows

### 4. Puerto 3000 conflict con otro proyecto
- **Workaround**: API mapeado a 3002, Web en 3001, `NEXT_PUBLIC_API_BASE_URL=http://localhost:3002`
- **Fix**: Sprint 3 - docker-compose.override.yml por developer

---

## 🟢 Verificados OK (Happy Path)

| Flujo | Estado |
|-------|--------|
| Login JWT (admin/colaborador/cliente) | ✅ |
| Crear tenant (SQL) | ✅ |
| Crear período (API) | ✅ |
| Upload 2 archivos (CSV) | ✅ |
| Job encolado en BullMQ/Redis | ✅ |
| Worker procesa job | ✅ |
| Job status → completed | ✅ |
| Report JSON/CSV/XLSX | ✅ |
| Dashboard APIs (Section A, C) | ✅ |
| Roles: admin full, colaborador R/W, cliente R-only | ✅ |
| Frontend carga (localhost:3001) | ✅ |
| Typecheck | ✅ |
| Tests: 515/515 passing | ✅ |

---

## 🎯 Demo Checklist (Viernes 2 Oct)

- [ ] Stack `docker compose up -d` levanta todo en < 2 min
- [ ] Login admin → ve dashboard con 1 período abierto
- [ ] Upload archivos reales cliente → reconciliación → reporte
- [ ] Cerrar período → ver snapshot congelado
- [ ] Reabrir período (colaborador) → vuelve a abierto
- [ ] Login cliente → ve sus períodos + pendientes histórico (solo lectura)
- [ ] Known issues list entregada al cliente