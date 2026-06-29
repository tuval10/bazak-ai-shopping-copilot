import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

/**
 * Renders the assistant's reply as markdown. The model emits bold/italic, "- " bullets,
 * the odd `code` span, and occasional links — react-markdown (+ gfm for lists/tables,
 * + breaks so a single newline is a line break, matching the model's intent) handles all
 * of it, while the component map keeps every element sized for a chat bubble (no giant
 * headings, tight spacing) and opens links safely in a new tab. Raw HTML is NOT enabled
 * (no rehype-raw), so model output can't inject markup.
 */
const block = "[&:not(:first-child)]:mt-2";

function Heading({ children }: { children?: ReactNode }) {
  return <p className={`font-semibold ${block}`}>{children}</p>;
}

const COMPONENTS: Components = {
  p: ({ children }) => <p className={block}>{children}</p>,
  ul: ({ children }) => <ul className={`list-disc pl-4 space-y-0.5 ${block}`}>{children}</ul>,
  ol: ({ children }) => <ol className={`list-decimal pl-4 space-y-0.5 ${block}`}>{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-bazak underline">
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="px-1 py-0.5 rounded bg-slate-200/70 text-[0.85em] font-mono">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className={`p-2 rounded bg-slate-200/70 overflow-x-auto text-[0.85em] font-mono ${block}`}>
      {children}
    </pre>
  ),
  h1: Heading,
  h2: Heading,
  h3: Heading,
  h4: Heading,
  h5: Heading,
  h6: Heading,
};

export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
}
