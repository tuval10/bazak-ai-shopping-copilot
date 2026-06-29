/**
 * Jest stub for the ESM-only remark plugins (remark-gfm / remark-breaks). The stubbed
 * react-markdown ignores plugins, so this just needs to resolve as a no-op transformer.
 */
export default function remarkPluginStub() {
  return undefined;
}
