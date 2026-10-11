const nextJest = require('next/jest');

// next/jest wires up SWC transforms + CSS/image/font mocks automatically so
// Next.js App Router components (including 'use client' files) transform the
// same way `next dev`/`next build` would — hand-rolling a ts-jest transform
// for TSX here would drift from that and silently pass/fail differently than
// the real app compiles.
const createJestConfig = nextJest({ dir: __dirname });

/** @type {import('jest').Config} */
const customJestConfig = {
  rootDir: __dirname,
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['<rootDir>/**/*.test.{ts,tsx}'],
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/'],
};

module.exports = createJestConfig(customJestConfig);
