const nextJest = require("next/jest.js");

// next/jest wires SWC transform, CSS/asset mocks, and tsconfig path aliases so tests
// run against the same module resolution as the app.
const createJestConfig = nextJest({ dir: "./" });

/** @type {import('jest').Config} */
const config = {
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
  testMatch: ["<rootDir>/tests/**/*.test.{ts,tsx}"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@bazak/shared$": "<rootDir>/../shared/src/index.ts",
    // The real client drags in ESM-only deps (jose) Jest won't transform; tests inject
    // their own mock clients, so stub the module to a constructable no-op.
    "^@mastra/client-js$": "<rootDir>/tests/mocks/mastra-client-stub.ts",
  },
};

module.exports = createJestConfig(config);
