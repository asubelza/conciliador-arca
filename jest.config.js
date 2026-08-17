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
};
