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
    // react-markdown + remark plugins are ESM-only; next/jest won't transform node_modules.
    // The app uses the real libs in the browser; tests stub them (markdown verified live).
    "^react-markdown$": "<rootDir>/tests/mocks/react-markdown-stub.tsx",
    "^remark-gfm$": "<rootDir>/tests/mocks/remark-plugin-stub.ts",
    "^remark-breaks$": "<rootDir>/tests/mocks/remark-plugin-stub.ts",
  },
};

module.exports = createJestConfig(config);
