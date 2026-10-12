# autenticacion-roles — Fase 4 (T43) + 2 bugs reales de infraestructura

**Branch:** `feature/mvp-carga-comprobantes-pr-3`
**Contexto:** cierre de `autenticacion-roles` (RF-14). Fase 1-3 ya estaban commiteadas (`c21718c`, `26a4c3c`) y verificadas contra el Postgres/Redis del sandbox de la nube, pero **nunca se había probado el stack completo contra el Docker real del cliente en su propia máquina** hasta esta tanda — que era, justamente, el objetivo de T43 (crear la primera cuenta real y loguearse de verdad).

## Status: completo. Login real verificado end-to-end contra `http://localhost:3001` en la máquina del cliente.

## T43 — alta de la cuenta admin

El cliente pidió una sola cuenta para arrancar (`admin@admin.com` / contraseña `admin`) y dijo que el resto las da de alta él mismo. Como no hay pantalla de alta pública (decisión de diseño de Fase 1), la creación es un INSERT directo:

- Hash generado con `bcryptjs` costo 12 (el mismo paquete y versión — `3.0.3` — que usa `auth.service.ts`), corrido en el sandbox de la nube. El formato bcrypt es autodescriptivo (el costo va embebido en el propio string, `$2b$12$...`), así que da igual en qué máquina se generó — `bcrypt.compare()` lo verifica igual en cualquier lado.
- El INSERT es un `ON CONFLICT (email) DO UPDATE`, a propósito: todavía no hay pantalla de "cambiar contraseña", así que volver a correr el mismo script es, por ahora, la forma de resetear la contraseña de esa cuenta si hace falta.
- Se corrió directamente contra el Postgres del cliente vía `docker compose exec -T postgres psql ... < archivo.sql` (el puente a la máquina del cliente puede escribir/leer archivos pero no llega a la red de contenedores Docker, así que el comando lo corrió el cliente, no yo — coherente con la disciplina del proyecto de no dar nada por hecho sin verificación real).

## Bug real #1: el servicio `migrate` tapaba sus propios fallos

Al intentar loguearse por primera vez, `POST /api/auth/login` tiraba `relation "users" does not exist` — la migración 018 nunca se había aplicado en la base real del cliente. Investigando por qué, apareció algo más grande: **tampoco existían `periodos` ni `periodo_resultados`** (`conciliacion-periodica`, T14-T32) ni los grants de `app_role` de la migración 017.

Causa raíz: `docker-compose.yml`'s `migrate` corría `node dist/migrate-runner.js && node dist/seed-runner.js || true`. Por precedencia de operadores de shell, eso es `(migrate-runner.js && seed-runner.js) || true` — el `|| true` (pensado para que un fallo del seed no sea fatal) también tapaba un fallo del propio `migrate-runner.js`. El contenedor salía con `Exited` (código 0) sin mostrar ningún error, así que cada `docker compose up` que el cliente corrió desde que arrancó `conciliacion-periodica` "parecía" funcionar bien.

Y por qué fallaba `migrate-runner.js` específicamente en la migración 001 (`tenants`, no en la 012+): `schema_migrations` (la tabla de tracking que hace que `migrate-runner.js` sea idempotente) es relativamente nueva — las migraciones 001-011 se habían aplicado a mano *antes* de que existiera ese tracking, así que nunca quedaron registradas ahí. Al toparse con la 001 (`CREATE TABLE tenants`), el runner encontraba que la tabla ya existía, tiraba error, y — por el bug de arriba — el contenedor lo tapaba en vez de fallar visiblemente.

**Verificado antes de tocar nada:** en vez de asumir "001-011 están aplicadas por el orden en que están los archivos", se corrió una query de solo lectura contra la base real del cliente confirmando explícitamente: RLS habilitada en las 3 tablas que toca la migración 007, las columnas que agregan 008/009, los grants de `app_role` que agrega 011, y — clave — que `vouchers_canonical.tipo` seguía siendo `character` (el esquema viejo de 004), no `tipo_cbte integer` (lo que crea la 012). Eso confirmó que el corte real estaba justo después de la 011, no de la 012 como parecía por las tablas visibles con `\dt`.

**Fix:**
1. Backfill de `schema_migrations` con las filas 001-011 (una sola vez, corrido a mano contra la base del cliente, no forma parte de ningún commit — es estado de esa base específica, no algo que una migración nueva deba forzar).
2. `docker-compose.yml`: `command: sh -c "node dist/migrate-runner.js && (node dist/seed-runner.js || true)"` — ahora solo el paso de seed es no-fatal. Commit `d22639d`.
3. `docker compose up -d --build` volvió a correr `migrate`, que esta vez sí aplicó 012-018 de verdad contra la base real (confirmado leyendo `docker compose logs migrate`: `applying: 012_...` hasta `018_...`, `Migrations applied: 7`).

## Bug real #2: al `api` le faltaba `JWT_SECRET`

Con las migraciones ya al día, el login seguía fallando — esta vez con `500` y, en los logs del contenedor `api`: `Error: JWT_SECRET is not set` (`jwt.ts`). `jwt.ts` tira ese error a propósito, sin ningún valor por default (para que un deploy real no arranque con un secreto trivial) — pero `docker-compose.yml` nunca se actualizó cuando la Fase 1 introdujo ese requisito, así que el `api` del cliente arrancaba sin la variable.

**Fix:** se agregó `JWT_SECRET` al `environment` del servicio `api` en `docker-compose.yml`, con un valor generado (no es un secreto real más allá de este deploy local de un solo estudio — mismo nivel de confianza que `POSTGRES_PASSWORD`, ya en texto plano ahí mismo). Solo `api` lo necesita — `worker` no toca el módulo de auth. Mismo commit `d22639d`.

## Por qué esto no se había detectado antes

Toda la verificación de `conciliacion-periodica`, los grants de `app_role`, el feedback del cliente, y las Fases 1-3 de autenticación se hizo contra Postgres/Redis reales, pero corriendo en el sandbox de la nube de esta sesión (contenedores `docker run` de larga duración, sin `docker-compose.yml` de por medio) — nunca contra el `docker-compose.yml` real ni la base persistente del cliente. Los tests de Jest tampoco lo hubieran detectado: usan su propia configuración de conexión (`jest.setup-env.ts`), no pasan por `migrate-runner.js` ni por el `docker-compose.yml`. Recién con T43 — que por primera vez pedía probar el login contra la máquina real del cliente — se terminó ejercitando ese camino end-to-end por primera vez desde que `conciliacion-periodica` arrancó.

## Verificación final

- `docker compose logs migrate` en la máquina del cliente: las 7 migraciones pendientes (012-018) se aplicaron sin error, seed corrió (12 filas de `afip_tipo_map`).
- Cuenta admin creada y confirmada con una consulta `SELECT` (sin mostrar el hash).
- Login real en `http://localhost:3001` con `admin@admin.com` / `admin`: confirmado por el cliente ("Perfecto todo corriendo ok").
- Fix de `docker-compose.yml` commiteado y verificado con `git log`/`git show --stat` corridos directamente sobre el repo del cliente — commit `d22639d`, 1 archivo, 23 inserciones/1 eliminación, coincide exactamente con lo esperado.

## Qué queda

- El límite documentado en Fase 1 sigue vigente: un token emitido antes de desactivar a un usuario sigue siendo válido hasta que expira (máx. 12hs).
- Ahora que `conciliacion-periodica` y `app_role` finalmente tienen su esquema real aplicado en la máquina del cliente, vale la pena que pruebe también esas pantallas (crear período, cargar, cerrar mes) contra su propio Docker — hasta ahora esa parte del sistema nunca había corrido de verdad ahí, aunque sí estaba verificada contra el sandbox de la nube.
- Autenticación (RF-14) queda funcionalmente completa y verificada de punta a punta, incluida la máquina real del cliente. Siguen pendientes, en el orden que el cliente eligió: matching difuso/tolerancia de fechas (RF-04/RF-13) y que el feedback influya en clasificaciones futuras (RF-09).
