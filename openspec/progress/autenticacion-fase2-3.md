# autenticacion-roles — Fase 2 + Fase 3 (RF-14)

**Branch:** `feature/mvp-carga-comprobantes-pr-3`
**Context:** continues directly from Fase 1 (commit `c21718c`: tablas `users`/`user_tenant_access`, `POST /api/auth/login`, `AuthGuard`, todo no disruptivo). Fase 2 y 3 se hicieron juntas, por elección explícita del cliente ("Fase 2 y 3 seguidas"), justamente para que la interfaz web nunca quede rota a mitad de camino — mismo patrón que `conciliacion-periodica`, donde separar backend/frontend en commits distintos había dejado la carga por pantalla devolviendo 400 durante una sesión entera.

## Status: completo (T37–T42), verificado, Fase 4 (alta manual de usuarios) pendiente y explícitamente fuera de esta tanda

## Fase 2 — todos los endpoints existentes ahora requieren login (T37–T39)

Cada controller (`tenants.controller.ts`, `periodos.controller.ts`, `reconciliations.controller.ts`) gana `@UseGuards(AuthGuard)` a nivel de clase. Dos funciones nuevas, mismo estilo "función directa, no capa de framework" que el resto del código (`validateTenantId`, `validatePeriodoIdParam`, etc.):

- **`assertRole(user, roles[])`** (`src/auth/role-check.ts`) — sin acceso a base, el rol ya viene en el JWT. Restringe las acciones de escritura que la arquitectura marcó como admin/colaborador-only: subir comprobantes, crear período, cerrar período, marcar (revisado/explicado), y `PUT` de configuración de tolerancia (esta última, admin-only).
- **`assertTenantAccess(pool, user, tenantId)`** (`src/auth/tenant-access.ts`) — admin/colaborador siempre pasan; `cliente` necesita una fila real en `user_tenant_access`, si no, 403 (nunca 404 — no delata si el tenant existe).

Para los endpoints donde el `tenant_id` no llega directo en la request (`GET /api/periodos/:id`, `POST /api/periodos/:id/cerrar`, `GET /api/periodos/:id/report`), se agregó `resolvePeriodoTenantId()` — una consulta liviana que resuelve el `tenant_id` del período *antes* de autorizar y *antes* de cualquier trabajo real (el cierre hace escrituras; el reporte de un período abierto recalcula el matching completo), en vez de aprovechar el `tenant_id` que esas funciones ya devuelven como efecto secundario más adelante.

**Un detalle real, no solo de forma:** `GET/POST /api/reconciliations/:jobId/...` no tiene un `tenant_id` de request tampoco — se resuelve desde `job.data.tenantId` (el mismo dato que el código ya usaba para escopear las queries a `reconciliation_results`, ahora también usado para autorizar).

## Fase 3 — frontend (T40–T42)

- **`lib/session.ts`** (nuevo): store de sesión sin dependencias de React fuera de un hook — módulo con estado propio (no Context) para que `lib/api.ts`, que no es un componente, pueda leer el token directamente. Persiste en `localStorage` (sobrevive un reload) además de en memoria. `useAuth()` usa `useSyncExternalStore` para que cualquier componente se re-renderice automáticamente ante login/logout/un 401.
- **`components/LoginForm.tsx`** (nuevo): email + contraseña, sin pantalla de alta (el cliente eligió cuentas creadas manualmente).
- **`app/page.tsx`**: si no hay sesión, muestra `LoginForm` en vez de la app — todo lo demás en el archivo asume usuario autenticado.
- **`lib/api.ts`**: cada `fetch` manda `Authorization: Bearer <token>` (`authHeaders()`); cualquier 401 limpia la sesión (`handleUnauthorized()`), lo que hace que `useAuth()` dispare un re-render y la pantalla vuelva sola al login — sin código de "redirect" explícito en ningún componente.
- **UI condicionada por rol:** `cliente` no ve "Cerrar Conciliación del Mes" (`PeriodoReportViewer.tsx`), ni el formulario "Crear período" (`PeriodoSelector.tsx`), ni el formulario de carga (`app/page.tsx` — en su lugar, un texto "Tu usuario es de solo lectura"). El panel de tolerancia de redondeo queda oculto para `cliente` **y** `colaborador` (admin-only, coincide con que el `PUT` server-side también es admin-only).

## Bug real encontrado durante esta misma tanda (no en una sesión aparte)

Los links de descarga CSV/Excel (`ReportViewer.tsx`, `PeriodoReportViewer.tsx`) eran `<a href={url}>` planos — una navegación de `<a>` no puede llevar un header `Authorization` custom, así que desde el momento en que Fase 2 protegió esos mismos endpoints de reporte, hacer click en "Descargar CSV" iba a devolver 401 en vez de descargar el archivo. Se encontró revisando el propio código al escribir esta fase (no hizo falta un reporte del cliente) y se corrigió antes de sincronizar nada: ambos botones ahora hacen un `fetch` autenticado y le entregan el blob resultante al navegador a través de un `<a download>` descartable (`lib/api.ts`'s `downloadAuthenticated()`), preservando el nombre de archivo que ya viene en el header `Content-Disposition` que el backend arma.

## Dos bugs reales encontrados en Fase 1 al correr los tests por primera vez (documentados acá porque se corrigieron en el mismo lote de trabajo que Fase 2/3, aunque el código en sí es de Fase 1)

1. **`POST /api/auth/login` devolvía 201, no 200** — Nest devuelve 201 por default en cualquier `@Post()` sin decorator explícito; se agregó `@HttpCode(HttpStatus.OK)`.
2. **El login no era case-insensitive de verdad** — `login()` ya hacía `.toLowerCase()` sobre el email de entrada, pero nada garantizaba que el email *guardado* estuviera en minúscula, así que un usuario creado con mayúsculas (`Ana@Estudio.com`) nunca iba a matchear. Se agregó un `CHECK (email = lower(email))` en la tabla `users` (migración 018) para que la garantía viva en la base, no solo en el código de un único call site — y `createTestUser` (helper de tests) ahora normaliza igual que cualquier alta real tendría que hacerlo.

Ambos se encontraron por los propios tests fallando contra Postgres real la primera vez que corrieron, no por inspección.

## Test Summary

- **Backend:** 408/408 (`npx jest --config jest.config.js` desde la raíz, Postgres 16 + Redis 7 reales) — 26 tests nuevos desde los 382 de después del feedback del cliente: 5 `tenant-access.test.ts`, 3 `role-check.test.ts`, y nuevos bloques de auth (401/403/cliente-con-y-sin-acceso) en `tenants.controller.test.ts` (+6), `periodos.controller.test.ts` (+7), `reconciliations.controller.test.ts` (+6, incluyendo un caso "cliente con acceso al tenant igual da 403" que prueba que el chequeo de rol aplica *independientemente* del chequeo de tenant). `tsc --noEmit` y `nest build` limpios.
- **Frontend:** 39/39 (`npx jest --config jest.web.config.js` desde `packages/web`, jsdom) — 18 tests nuevos: `session.test.ts` (8, incluyendo hidratación desde `localStorage` con un módulo recién importado, simulando un reload real), `LoginForm.test.tsx` (2), `app/page.test.tsx` (2, el primer test de `page.tsx` que existe en el proyecto — antes solo estaba cubierto por la corrida de Playwright de PR-6), y nuevos bloques de "role-gating" + descarga autenticada en `PeriodoSelector.test.tsx`/`PeriodoReportViewer.test.tsx`/`ReportViewer.test.tsx`. `tsc --noEmit` y `next build` limpios.
- Se corrigió además un bug de configuración de tests preexistente pero recién expuesto por este trabajo: `jest.config.js` (raíz) tenía `testMatch: 'packages/**/*.test.ts'`, que sin querer también agarraba `packages/web/lib/session.test.ts` (el primer `.test.ts` — no `.test.tsx` — que existe bajo `packages/web`) y lo corría contra el entorno Node del backend (sin `window`). Acotado a `packages/api` + `packages/shared-types` explícitamente.
- Sin regresiones: todo lo de MVP + `conciliacion-periodica` + `app_role` grants + feedback del cliente + Fase 1 de auth sigue pasando sin cambios.

## Qué queda

- **Fase 4 (T43): crear las cuentas reales del estudio.** No es código — es correr un insert (con `bcryptjs` para el hash) contra la base de producción una vez que el cliente confirme quién necesita qué rol. Explícitamente no arrancada todavía.
- El límite documentado en Fase 1 sigue vigente: un token emitido antes de desactivar a un usuario sigue siendo válido hasta que expira (máx. 12hs) — el `AuthGuard` no consulta la base en cada request.
