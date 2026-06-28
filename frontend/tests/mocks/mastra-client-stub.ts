/**
 * Test stub for `@mastra/client-js`. The real client pulls in ESM-only transitive deps
 * (jose) that Jest won't transform, and our tests never hit a live server anyway — they
 * inject mock clients into the api-client functions. This stub just needs to construct so
 * the `mastraClient` singleton in `lib/mastra-client.ts` can be imported safely.
 */
export class MastraClient {
  constructor(_options?: unknown) {}
}
