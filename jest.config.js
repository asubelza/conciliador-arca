/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^shared-types$': '<rootDir>/packages/shared-types/src',
  },
  testMatch: ['<rootDir>/packages/**/*.test.ts'],
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
