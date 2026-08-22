# Propuesta técnica: Autenticación y roles de usuario (RF-14)

## Por qué

Cubre RF-14 de la propuesta funcional original (`claude/preproyecto_conciliacion_arca.md`), señalado como gap real el 2026-08-22 al revisar qué quedaba fuera del alcance construido hasta ahora: hoy la API no tiene ningún control de acceso — cero dependencias de auth instaladas, ningún guard, nada. RLS por `tenant_id` aísla los datos a nivel de base, pero solo protege si el `tenant_id` correcto llega en el request; cualquiera que pueda llamar a la API puede pasar el `tenant_id` de cualquier tenant y leer sus datos. Con CUIT, montos e información fiscal real (RNF-01), esto es lo más urgente de cerrar antes de exponer el sistema fuera de un entorno controlado.

Elegido por el usuario (AskUserQuestion, 2026-08-22) como el primero de tres puntos a encarar, antes que el matching por similitud (RF-04/RF-13) y el feedback-driven learning (RF-09) — porque toca casi todos los endpoints existentes y conviene que esas dos funcionalidades se construyan ya con el modelo de usuarios/roles en su lugar.

## Alcance

- Login con email + contraseña (elegido por el usuario sobre magic link / Google).
- 3 roles, per RF-14 (elegido: los 3 completos desde el arranque):
  - **admin**: acceso total — todos los tenants, puede cambiar configuración (tolerancia), cerrar períodos, gestionar usuarios.
  - **colaborador**: puede cargar comprobantes, ver reportes, cerrar períodos — no puede cambiar configuración de tenant ni gestionar usuarios.
  - **cliente**: solo lectura, y solo de los tenants a los que se le dio acceso explícitamente (normalmente uno).
- Alta de cuentas: manual (elegido por el usuario) — no hay pantalla de registro pública en esta fase; las cuentas se insertan directo en la base (un script/seed, igual que `seed-runner.ts` siembra `afip_tipo_map`).
- Protege todos los endpoints existentes de `periodos`, `reconciliations` y `tenants` — ninguno queda accesible sin un JWT válido.

## Fuera de alcance (esta fase)

- Recuperación de contraseña / invitación por email (requiere poder enviar emails — no hay proveedor configurado; se puede agregar después sin romper nada).
- Multi-estudio (esta instancia es de un solo estudio contable — `estudiocontablejy@gmail.com's Organization` — así que `admin`/`colaborador` implican acceso a **todos** los tenants de esa cuenta, sin necesidad de una tabla `estudios` separada; ver architecture.md).
- 2FA.

## Decisiones técnicas (criterio del desarrollador, documentadas para que el cliente las corrija si hace falta — mismo patrón que `periodo_alta_id` en PR-5)

- **JWT stateless** (no sesiones server-side) — `jsonwebtoken` + `bcryptjs`, sin Passport: mantiene la filosofía del resto del código (funciones de validación directas, sin capas de framework extra — ver `tenants.controller.ts`).
- Token en `Authorization: Bearer <jwt>`, no cookie — el frontend (otro origen/puerto) ya llama a la API con `fetch` plano; agregar cookies cross-origin sumaría complejidad de CORS/SameSite sin necesidad real en esta fase interna.
- `role` es un campo global del usuario, no por-tenant — porque no existe (ni hace falta) una entidad "estudio" separada de `tenants`: un solo estudio administra todos sus tenants. Solo `cliente` necesita una tabla de acceso explícito por tenant (`user_tenant_access`), porque ahí sí el acceso debe ser restringido a uno o pocos tenants.
- Sin recuperación de contraseña todavía: si alguien la olvida, un admin genera una nueva a mano (mismo mecanismo que el alta).

## Fases (mismo patrón que `conciliacion-periodica`)

1. **Fase 1 — infraestructura de auth (no rompe nada todavía):** tablas `users`/`user_tenant_access`, hash de contraseñas, `POST /api/auth/login`, emisión/verificación de JWT, guard de autenticación, un endpoint protegido de prueba (`GET /api/auth/me`). Los endpoints existentes siguen sin protección — se agrega en la Fase 2.
2. **Fase 2 — proteger todo lo existente (rompe el acceso sin login, como pasó con el upload en `conciliacion-periodica`):** todos los endpoints de `periodos`/`reconciliations`/`tenants` exigen JWT válido; chequeo de rol y de acceso a tenant (`cliente` solo ve lo suyo).
3. **Fase 3 — frontend:** pantalla de login, el token viajando en cada `fetch`, UI condicionada por rol (ocultar "Cerrar Conciliación del Mes" y configuración de tolerancia para `cliente`; ocultar configuración para `colaborador`).
4. **Fase 4 — alta manual de tus cuentas:** te doy tu usuario admin y los de tu equipo una vez que todo esté verificado.
