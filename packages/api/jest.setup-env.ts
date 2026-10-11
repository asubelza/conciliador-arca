// Test-only defaults for local/dev integration tests against real
// PostgreSQL + Redis. Real deployments set these via the environment; this
// file only fills gaps so `npm test` works out of the box against the
// services documented in claude/guia_prueba_local.md.
process.env.DATABASE_URL ??= 'postgresql://conciliador:conciliador@localhost:5432/conciliador_arca_test';
process.env.REDIS_HOST ??= 'localhost';
process.env.REDIS_PORT ??= '6379';
// T34 (autenticacion-roles): a real deploy MUST set its own JWT_SECRET —
// this fallback exists only so tests don't need one configured, same spirit
// as the DATABASE_URL default above.
process.env.JWT_SECRET ??= 'test-only-jwt-secret-do-not-use-in-production';
