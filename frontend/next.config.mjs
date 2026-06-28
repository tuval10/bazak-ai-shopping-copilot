import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The shared contract is a TS workspace package consumed as source — let Next
  // transpile it rather than expecting a pre-built dist.
  transpilePackages: ["@bazak/shared"],
  // Monorepo: pin the file-tracing root to the workspace so Next doesn't guess from
  // the multiple lockfiles it detects.
  outputFileTracingRoot: join(here, ".."),
  // We gate quality on `tsc --noEmit` + Jest; no separate ESLint config is shipped,
  // so don't let an absent linter block the production build.
  eslint: { ignoreDuringBuilds: true },
  images: {
    // DummyJSON catalog thumbnails. We render them via plain <img> (the card has a
    // JS fallback), so this is informational, but allow the host if next/image is used.
    remotePatterns: [{ protocol: "https", hostname: "cdn.dummyjson.com" }],
  },
};

export default nextConfig;
