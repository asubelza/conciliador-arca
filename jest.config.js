/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^shared-types$': '<rootDir>/packages/shared-types/src',
  },
  // Scoped to api + shared-types only — packages/web has its own
  // jest.web.config.js (jsdom env, next/jest transform, path aliases).
  // T39 (autenticacion-roles) added packages/web/lib/session.test.ts, the
  // first plain *.test.ts (not *.test.tsx) file under packages/web; without
  // this explicit scope it was matched here too and failed for the obvious
  // reason (no `window` in this config's node test environment).
  testMatch: ['<rootDir>/packages/api/**/*.test.ts', '<rootDir>/packages/shared-types/**/*.test.ts'],
  collectCoverageFrom: [
    'packages/shared-types/src/**/*.ts',
    'packages/api/src/**/*.ts',
  ],
  coverageDirectory: 'coverage',
  verbose: true,
  // T05: integration tests hit real PostgreSQL/Redis; fill in connection
  // defaults the same way packages/api/jest.api.json does (see
  // packages/api/jest.setup-env.ts), and give them enough time to run.
  setupFiles: ['<rootDir>/packages/api/jest.setup-env.ts'],
  testTimeout: 20000,
};
