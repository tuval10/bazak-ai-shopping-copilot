import type { ReactNode } from "react";

/**
 * Jest stub for react-markdown (ESM-only; next/jest won't transform it — same approach
 * the repo uses for @mastra/client-js). The app renders real markdown in the browser;
 * tests only need the text to be present, so this renders the raw children. Markdown
 * formatting itself is verified live, not in jsdom.
 */
export default function ReactMarkdown({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export type Components = Record<string, unknown>;
