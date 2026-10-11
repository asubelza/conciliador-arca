# Arquitectura: Autenticación y roles (RF-14)

## Modelo de datos

```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'colaborador', 'cliente')),
  display_name  TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Solo tiene sentido para role='cliente': a qué tenant(s) puede ver.
-- admin/colaborador ven todos los tenants implícitamente y nunca
-- necesitan una fila acá (ver "Por qué no hay tabla `estudios`" abajo).
CREATE TABLE user_tenant_access (
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, tenant_id)
);
```

`is_active` en vez de `DELETE` — desactivar a alguien no debería romper referencias históricas (auditoría, `cerrado_por`, etc.); un login con `is_active = false` se rechaza igual que una contraseña incorrecta (mismo mensaje genérico, para no filtrar si el email existe).

### Por qué no hay tabla `estudios`

RF-11 pide multi-cliente "dentro de una misma cuenta de estudio contable". Esta instancia corre para un solo estudio (`estudiocontablejy@gmail.com's Organization`) — no hay ni un concepto de "estudio" en el schema hoy, solo `tenants` (= las empresas cliente del estudio). Agregar una tabla `estudios` para modelar "N estudios, cada uno con sus propios tenants/usuarios" sería sobre-ingeniería para un requisito que no existe todavía (un solo estudio usando el sistema). Si en el futuro el producto pasa a ser multi-estudio, `users`/`tenants` ganarían un `estudio_id` compartido — cambio contenido, no una reescritura.

## Autenticación

- `bcryptjs` para hashear contraseñas (cost factor 12).
- `jsonwebtoken` para firmar/verificar — sin Passport, mismo estilo del resto del código (funciones directas, no capas de framework).
- `POST /api/auth/login` → `{ email, password }` → `200 { token, user: { id, email, role, display_name } }` o `401` genérico (nunca revela si el email existe).
- Token: `{ sub: userId, role, email }`, firmado con `JWT_SECRET` (env var; un default solo para test/dev con un comentario fuerte, igual que `DATABASE_URL` en `jest.setup-env.ts`), expira a las 12 horas.
- El frontend manda el token en `Authorization: Bearer <token>` en cada request — no cookies (ver proposal.md, "Decisiones técnicas").

## Autorización

- `AuthGuard` (`@nestjs/common`'s `CanActivate`): lee el header, verifica el JWT, adjunta `req.user = { id, role, email }`. Sin token o token inválido/expirado → 401. Aplicado por controller con `@UseGuards(AuthGuard)` (no global todavía — permite que `POST /api/auth/login` quede fuera sin un decorator `@Public()` extra).
- Autorización de tenant: una función simple `assertTenantAccess(user, tenantId)` (no un decorator/guard separado — mismo estilo "función de validación directa" que `validateTenantId`, `validatePeriodoIdParam`, etc.):
  - `admin`/`colaborador` → siempre permitido.
  - `cliente` → permitido solo si existe una fila en `user_tenant_access` para ese `user_id`+`tenant_id`; si no, `403`.
- Autorización de rol para acciones de escritura específicas:
  - `PUT /api/tenants/:id/config` → solo `admin`.
  - `POST /api/reconciliations` (subir), `POST /api/periodos`, `POST /api/periodos/:id/cerrar`, `POST /api/reconciliations/:jobId/marks` → `admin`/`colaborador` (no `cliente`).
  - Todo `GET` (listar/ver/reportes) → los 3 roles, sujeto a `assertTenantAccess`.

## Endpoints existentes a proteger (Fase 2)

| Endpoint | Chequeo |
|---|---|
| `POST/GET /api/periodos`, `GET /api/periodos/:id` | auth + `assertTenantAccess` (tenant_id en body/query, o el `tenant_id` del período ya resuelto) |
| `POST /api/periodos/:id/cerrar` | auth + rol admin/colaborador + `assertTenantAccess` sobre el `tenant_id` del período (se resuelve primero, luego se autoriza, antes de cualquier escritura) |
| `GET /api/periodos/:id/report` | auth + `assertTenantAccess` |
| `POST /api/reconciliations`, `GET .../status`, `GET .../report`, `POST .../marks` | auth + rol (subir/marcar: admin/colaborador; ver: los 3) + `assertTenantAccess` |
| `GET/PUT /api/tenants/:id/config` | auth + (`PUT`: solo admin) + `assertTenantAccess` |

## Frontend (Fase 3)

- Pantalla de login (`app/login/page.tsx` o similar) — email+password → guarda el token (in-memory + `localStorage` para persistir entre reloads; ver proposal.md's tradeoff documentado) → redirige a la pantalla principal.
- `lib/api.ts`: todo `fetch` existente gana un header `Authorization` leído de un módulo de sesión simple.
- Un 401 en cualquier request → limpia el token y vuelve a login.
- UI condicionada por `role`: `PeriodoReportViewer.tsx` oculta "Cerrar Conciliación del Mes" para `cliente`; `PeriodoSelector.tsx` oculta el panel de configuración de tolerancia para `cliente`/`colaborador`.

## Grants de `app_role`

Mismo estándar que la migración 017 — `users`: `SELECT, INSERT, UPDATE` (sin `DELETE`, se usa `is_active`); `user_tenant_access`: `SELECT, INSERT, DELETE` (otorgar/revocar acceso de un cliente es una operación normal, no hace falta `UPDATE` porque la fila no tiene más columnas que las de la PK).
