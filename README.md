# bazak-ai-shopping-copilot

AI shopping copilot for Bazak — a conversational interface that helps users discover products from
the DummyJSON catalog through natural-language chat.

## Project Documents

| Document | What's in it |
|----------|--------------|
| [assignment.MD](assignment.MD) | The original assignment brief — overview, requirements, deliverables, and the questions this README must ultimately answer. The source of truth for *what's being asked*. |
| [USER_STORIES.md](USER_STORIES.md) | What we're building and how it should behave — in-scope user stories grouped into epics, with acceptance criteria and a decision log for every edge case (ambiguous / off-catalog / chit-chat / multi-intent / no-results / follow-ups). The source of truth for *scope and intended behavior*. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | The whole system in one picture — layers, the end-to-end request flow, the orchestration pipeline, retrieval strategy, the HTTP/streaming API, and the data model. The source of truth for *how the pieces fit*. |
| [STRUCTURE.md](STRUCTURE.md) | The repository layout — the three workspace packages (`shared/`, `server/`, `frontend/`), what lives in each directory, and the per-package test strategy. The source of truth for *where code goes*. |
| [DECISIONS.md](DECISIONS.md) | Architecture decision log — topology, orchestration (Mastra), persistence (Mastra Memory / LibSQL), front-end chat layer (own Next.js UI on `@mastra/client-js`), routing, and the streamed response payload, each with rationale and rejected alternatives. The source of truth for *why it's built this way*. |
| [FUTURE.md](FUTURE.md) | Deliberately deferred scope (security/abuse controls, profile & personalization, analytics, performance budget, richer product views) — so the cuts are intentional rather than forgotten. |
| [UX/SCREENS.md](UX/SCREENS.md) | The two top-level screens (Conversations List, Conversation) — what each is for and the states it covers. The source of truth for *what screens exist*. |
| [UX/COMPONENTS.md](UX/COMPONENTS.md) | The five reusable building blocks (user message, bot message, product catalog, no-results, loading) — how each looks and behaves. The source of truth for *the pieces inside the screens*. |
| [UX/mocks/](UX/mocks/index.html) | High-fidelity static HTML mockups of the screens and components in all key states. Open [UX/mocks/index.html](UX/mocks/index.html) in a browser — no build step. |

## Getting started

A npm-workspaces monorepo with three packages: **`shared/`** (the Zod contract), **`server/`** (the
Mastra orchestration server), and **`frontend/`** (an own Next.js chat UI on `@mastra/client-js`). The
server and frontend run as two decoupled processes.

### Prerequisites
- Node.js ≥ 20
- An OpenAI API key

### Install
```bash
npm install
```

### Configure
Create `server/.env` with your key (gitignored):
```bash
OPENAI_API_KEY=sk-...
```

### Run (two terminals)
```bash
# 1) the Mastra server on http://localhost:4111 — `npm start` builds the bundle and
#    serves it; `npm run dev --workspace=@bazak/server` (mastra dev, with Studio) also works.
npm start --workspace=@bazak/server

# 2) the frontend — Next.js dev server on http://localhost:3000
npm run dev --workspace=@bazak/frontend
```
Open <http://localhost:3000>. The frontend talks to the server at `http://localhost:4111` by default;
override with `NEXT_PUBLIC_MASTRA_URL`. CORS is enabled on the server so the browser app can call it
cross-origin (D11).

> **Note:** keep zod deduped to one version across the workspace — a workspace package with its own
> `node_modules/zod` at a different major crashes Mastra Studio at boot (a clean `npm install` dedupes it).
> See DECISIONS D9a.

### Test
```bash
npm test            # all workspaces: shared (Vitest) + server (Vitest) + frontend (Jest + RTL)
npm run typecheck   # tsc --noEmit across all workspaces
```
Tests use no live model, network, or server — OpenAI and DummyJSON are mocked on the server, and the
frontend injects mock Mastra clients. The shared Zod schemas are the seam: the server validates the parts
it emits and the frontend re-validates the same shapes, so the two can't drift.

### How it fits together
A turn streams from the pipeline workflow (`POST /api/workflows/pipeline/stream`): the frontend reads
`data-product-results` parts off the stream and renders each as a product-card group, with the prose
summary landing at the end. Conversations are Mastra Memory threads (list / resume / history); each
assistant turn persists its results as message metadata so a refresh rehydrates the cards (D12). See
[ARCHITECTURE.md](ARCHITECTURE.md) for the full picture.
