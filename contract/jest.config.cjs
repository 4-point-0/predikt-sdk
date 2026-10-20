// Contract tests: the built SDK against the backend's real controllers, DTO validation and
// mappers. They run with the backend's own jest/ts-jest and node_modules; see contract/run.mjs.
const path = require('node:path');

const backend = process.env.BACKEND_DIR || path.resolve(__dirname, '../../predikt-aggregator');

module.exports = {
  rootDir: backend,
  roots: [__dirname],
  testMatch: ['**/*.contract.ts'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  modulePaths: [path.join(backend, 'node_modules')],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: path.join(backend, 'tsconfig.json'), diagnostics: false }],
  },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testEnvironment: 'node',
  testTimeout: 60000,
};
