# bazak-ai-shopping-copilot

AI shopping copilot for Bazak — a conversational interface that helps users discover products from the
DummyJSON catalog through natural-language chat. A thin Next.js client streams from a local **Mastra**
server that runs each turn as a **bounded supervisor-agent loop**.

This README is the primary deliverable: **setup & run**, the **architecture & framework choice**, the
**retrieval strategy**, **conversation & state management**, the **evaluation strategy**, and **known
limitations**. Deeper rationale lives in the companion docs.

### Companion documents
| Document | What's in it |
|----------|--------------|
| [DECISIONS.md](DECISIONS.md) | The architecture decision log — every choice (topology, Mastra, persistence, UI, routing) with rationale and rejected alternatives, plus an *Outdated decisions* section. Referenced inline below as `Dn`. The source of truth for *why it's built this way*. |
| [USER_STORIES.md](USER_STORIES.md) | In-scope user stories grouped into epics, with acceptance criteria and a decision log per edge case. Referenced below as `US-x`. The source of truth for *intended behavior*. |
| [STRUCTURE.md](STRUCTURE.md) | The repo layout — the three workspace packages and what lives where. The source of truth for *where code goes*. |
| [FUTURE.md](FUTURE.md) | Deliberately deferred scope, so the cuts are intentional rather than forgotten. |
| [UX/](UX/SCREENS.md) | Screens, components, and high-fidelity static HTML mockups (`UX/mocks/index.html`). |

---

## Setup & Run

A npm-workspaces monorepo with three packages: **`shared/`** (the Zod contract), **`server/`** (the Mastra
orchestration server), and **`frontend/`** (an own Next.js chat UI on `@mastra/client-js`). The server and
frontend run as two decoupled processes.

### Prerequisites
- **Node.js ≥ 20**
- An **OpenAI API key**

### 1. Install dependencies
```bash
npm install        # installs all three workspaces and dedupes shared deps
```

### 2. Configure environment variables
Create `server/.env` (gitignored) with your key:
```bash
OPENAI_API_KEY=sk-...
```
Optional knobs (sensible defaults if unset):

| Var | Where | Purpose |
|-----|-------|---------|
| `MAX_PRODUCT_FINDERS` | server | hard cap on finder runs per turn (catalog-cost ceiling) |
| `SUPERVISOR_MAX_STEPS` | server | hard cap on supervisor tool-turns per turn |
| `FINDER_MAX_STEPS` | server | cap on tool-calling steps inside each finder |
| `LOG_LEVEL` | server | PinoLogger level (`debug` surfaces the per-turn trace) |
| `NEXT_PUBLIC_MASTRA_URL` | frontend | server URL (default `http://localhost:4111`) |
| `EVAL_JUDGE_MODEL` | evals | override the LLM-as-judge model (default `gpt-5.4`) |

### 3. Run locally (two terminals)
```bash
# 1) the Mastra server on http://localhost:4111 — `npm start` builds the bundle and serves it;
#    `npm run dev --workspace=@bazak/server` (mastra dev, with Studio) also works.
npm start --workspace=@bazak/server

# 2) the frontend — Next.js dev server on http://localhost:3000
npm run dev --workspace=@bazak/frontend
```
Open <http://localhost:3000>. The frontend talks to the server at `http://localhost:4111` by default
(override with `NEXT_PUBLIC_MASTRA_URL`); CORS is enabled server-side so the browser app can call it
cross-origin (D11).

> **Note:** keep zod deduped to one version across the workspace — a workspace package with its own
> `node_modules/zod` at a different major crashes Mastra Studio at boot (a clean `npm install` dedupes it).
> See DECISIONS D9a.

### 4. Execute tests
```bash
npm test            # all workspaces: shared (Vitest) + server (Vitest) + frontend (Jest + RTL)
npm run typecheck   # tsc --noEmit across all workspaces
npm run eval --workspace=@bazak/server   # LLM-as-judge evals (real models + live catalog; slow)
```
`npm test` uses **no live model, network, or server** — OpenAI and DummyJSON are mocked on the server and
the frontend injects mock Mastra clients. `npm run eval` is the opposite: it exercises the real pipeline
end-to-end (see *Evaluation Strategy*).

---

## Architecture & Framework Choice

### System overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ BROWSER  —  own Next.js App-Router UI (D8, D11), client-side only           │
│   • hand-built chat shell: thread · composer · streaming · autoscroll       │
│   • <ProductResults> → product-results: grid · hero · table (D6, D16)       │
│   • @mastra/client-js talks straight to the server (no FE backend)          │
│ holds only the conversation id, in the URL  /c/{id}  (D5)                   │
└──────────────▲─────────────────────────────────────────┬────────────────────┘
               │ workflow stream:                        │ client-js fetch:
               │ assistant text + product-results parts  │ create / list / load
┌──────────────┴─────────────────────────────────────────▼────────────────────┐
│ LOCAL SERVER  —  Mastra server (built bundle, port 4111)  (D1, D7, D9)      │
│ owns:  OpenAI key  ·  orchestration  ·  persistence                         │
│                                                                             │
│  ┌─ Mastra workflow `pipeline`  =  one `converse` step   (D15, D16) ─────┐  │
│  │ SUPERVISOR agent (gpt-5.4-mini) — decide → call tool(s) → read        │  │
│  │ grounded results → write reply.  Holds Memory.  Bounded by            │  │
│  │ SUPERVISOR_MAX_STEPS / MAX_PRODUCT_FINDERS (caps in code).            │  │
│  │   │                                                                   │  │
│  │   ├─ find_products ─▶ DISCOVERY finder agent (gpt-5.4-mini)           │  │
│  │   │                    └─ product_search · category_browse ─▶ catalog │  │
│  │   ├─ recommend_product ┐ spotlight / compare ALREADY-shown            │  │
│  │   └─ compare_products ─┘ products, grounded by id (registry)          │  │
│  │ tools emit grounded cards → writer.custom → data-product-results      │  │
│  └────────▲──────────────────────────────────────────────┬───────────────┘  │
│  ┌────────┴───────────────┐                    ┌──────────▼───────────┐     │
│  │ Mastra Memory (LibSQL) │                    │ DummyJSON client      │    │
│  │  • threads→transcript  │                    │  pick endpoint→fetch  │    │
│  │  • workmem→prefs (D4)  │                    │  →filter/sort/page    │    │
│  └────────────────────────┘                    └──────────────────────┘     │
└─────────────────────────────────────────────────────┬───────────────────────┘
                                                      │ HTTPS
                     ┌────────────────────────────────┴───────────────────────┐
                     │ OpenAI API                     │ DummyJSON Products API│
                     │ gpt-5.4-mini (supervisor       │ (read-only catalog)   │
                     │ + discovery finder)            │                       │
                     └────────────────────────────────┴───────────────────────┘
```

The browser is a **thin client** (D1): it holds only the conversation id and renders what it's streamed.
All orchestration, the OpenAI key, and all persistence live on the local server. The turn is **agentic** —
a supervisor agent loop — but it runs **inside a deterministic Mastra workflow shell** whose surrounding
code enforces every invariant (grounding, caps, dedup, persistence).

### Why Mastra (the framework choice)

> The full ADR is **D7** (framework), with the agentic shape in **D15/D16**.

The orchestration layer is built on **[Mastra](https://mastra.ai)** — a TypeScript-native framework that
bundles **agents + tools + workflows + memory + tracing + evals** on top of the Vercel AI SDK. Four
properties decided it, each tied to a concrete requirement of *this* assignment:

**1. Memory out of the box (the persistence + personalization requirement).** Mastra Memory gives us, with
near-zero code: **threads** (the conversation transcript, plus list / resume / search — US-3.x) and
**working memory** (a durable, per-user preferences doc — Epic 7), backed by embedded **LibSQL** (SQLite).
Conversation storage *and* the personalization loop come from one store instead of two hand-rolled layers
(D4). **Semantic recall** (vector search over messages) sits in the same store for later.

**2. A dev platform: tracing & observability (the debugging requirement).** Mastra Studio + OpenTelemetry
give **step-, agent-, and tool-level traces of every run** — you can watch the supervisor decide, each
`find_products` call, and each inner search/browse the finder makes. This stopped being a nice-to-have the
moment the turn became an agentic loop: a multi-round, model-driven turn is only defensible if you can
*see* every tool call it made.

**3. Workflow + agent primitives together — so it's an *agentic workflow*, not "just one agent."** This is
the crux. We deliberately did **not** ship a bare single-agent-with-tools left to its own devices. We ship
a **supervisor agent loop wrapped in a one-step Mastra workflow** (`pipeline → converse`): the agent has
real freedom *inside* the loop (decide whether to search, search per angle, recommend, compare, weave
reasoning), while the **code around the loop enforces the invariants** — grounding by product id, hard
finder/step caps, already-shown dedup, and persistence (D15). A single-agent SDK gives you the loop but not
the enforced shell; a pure workflow engine gives you the shell but makes the agentic loop awkward. Mastra
gives **both in one stack**, so we get agentic flexibility *without* surrendering the deterministic,
testable seams the eval suite depends on.

**4. Evaluation out of the box (the testing requirement).** Mastra ships a first-class **evals** framework
— score a run against assertions and LLM-judges as part of the normal test suite — so the agentic turn's
behaviors (ambiguous, off-catalog, multi-intent, grounding) run as **server evals** (US-6.1) instead of a
bolted-on harness. Once the model decides the control flow, evals are how you keep it honest as prompts
evolve.

**Alternatives considered and why they were rejected here:**

| Alternative | Why rejected for *this* assignment |
|-------------|------------------------------------|
| **Vercel AI SDK direct** | The lightest option, and Mastra is built *on* it (so we keep its streaming at the UI edge either way). But it ships no Studio/tracing, no first-class evals, no Memory primitive, and no workflow engine — we'd hand-roll persistence, working memory, and the bounded-loop shell ourselves. The honest fallback only if the flow had stayed non-agentic. |
| **LangChain / LangGraph (JS)** | Powerful graph + durable checkpoints, but Python-first with grafted TS that trails releases, heavier, and a weaker local/serverless story. Overkill for a single-user local app. |
| **Fully custom orchestration** | Maximum control, but reinvents the orchestration, streaming, memory, and tracing Mastra gives for free — exactly the plumbing we'd rather not own and defend. |

> **On "not a single agent":** we deliberately did **not** ship a bare single-agent-with-tools loop
> (non-deterministic, hard to eval). What we ship is a **bounded** agent loop *inside* the workflow shell,
> with grounding and caps enforced in code (D15) — agentic flexibility without losing the testable seams.

**Front-end framework (a separate choice — the *chat UI*, not the orchestration framework; D8/D11).** We
built our own small chat shell on `@mastra/client-js` rather than adopt a UI framework:

| Alternative | Why rejected |
|-------------|--------------|
| **assistant-ui** | Every official assistant-ui ⇄ Mastra path assumes an **agent** stream, not our **workflow** stream; its card-rendering API is deprecated; and our cards are a server-produced **data part**, not a model tool-call — so the integration cost exceeded the shell it would have saved (D8). |
| **CopilotKit** | Built to bolt a copilot **onto an existing app**; wrong shape for a chat-first app (D8). |
| **LibreChat** | A finished self-hosted chat *product*; wrong shape for a bespoke discovery UI with custom cards and our own persistence (D7). |

### Components & responsibilities

| Layer | Component | Responsibility | ADR |
|------|-----------|----------------|-----|
| Front-end | **Own Next.js App-Router UI** | Hand-built chat shell (thread/composer/streaming/autoscroll); `<ProductResults>` renders streamed `product-results` parts as grids / a recommendation hero / a comparison table | D8, D11, D6, D16 |
| Data layer | **`@mastra/client-js`** | Browser client to the Mastra endpoints (workflow stream + memory threads + `/profile`); responses validated against `@bazak/shared` | D8, D11 |
| Transport | **Mastra workflow stream** | Streams assistant text + custom `data-product-results` parts to the client | D6, D7 |
| Host | **Mastra server** (built bundle) | Serves the streaming + memory-thread + profile endpoints; keeps the OpenAI key server-side | D1, D9 |
| Orchestration | **Mastra workflow `pipeline`** (one `converse` step) | Deterministic shell: the streaming rail + the persistence boundary around the agent loop | D7, D15 |
| Brains | **`supervisor` agent** (gpt-5.4-mini) | Drives the whole turn: decides whether/how to retrieve, calls the three grounded tools, holds Memory, writes all prose | D15, D16 |
| Retrieval | **`discovery` finder sub-agent** (gpt-5.4-mini) | Driven by `find_products`; uses `product_search` + `category_browse` tools to retrieve + relax, selects products **by id** | D13, D15 |
| Storage | **Mastra Memory on LibSQL** | Threads (conversation transcript) + working memory (durable per-user prefs) | D4 |
| External | **OpenAI** | `gpt-5.4-mini` for both agents (judgment-heavy; nano was unreliable, D13) | D13, D15 |
| External | **DummyJSON Products API** | Read-only product catalog | — |

### Request lifecycle — one turn, end to end

```
user types ──▶ POST /api/workflows/pipeline/stream   { inputData: { message, threadId, resourceId } }
                  │
   1. load        ├─ loadThreadContext: shown ids (dedup) + last turn's products + a grounding
                  │     registry of full Product records — from persisted message metadata (D12)
   2. supervise   ├─ supervisor agent (gpt-5.4-mini) DECIDES what the turn needs and loops over tools:
                  │     • shopping need      → find_products (once per distinct item / angle)
                  │     • "which is best?"   → recommend_product (a spotlight, badge)   ┐ ground by id
                  │     • "torn between X/Y" → compare_products (a spec table)          ┘ from the registry
                  │     • a plain question / chit-chat / off-catalog → answer in prose, no tool
                  │   each find_products drives the DISCOVERY finder (search → relax) and returns a
                  │   lean narrative the supervisor reads to decide next steps + write the reply
   3. stream      ├─ each tool emits its grounded cards itself via writer.custom(...) as it resolves
                  │     (one data-product-results part per group; display = grid | recommendation | comparison)
   4. reply       ├─ supervisor writes the assistant summary, weaving per-item reasoning into the prose
   5. learn       ├─ if a DURABLE preference surfaced, the supervisor updates working memory (US-7.1)
   6. persist     ├─ Memory saves the transcript; converseStep persists the turn's results + chips +
                  │     finders as assistant-message metadata (D12) for resume / "show me more"
                  ▼
   stream ──▶ own UI: text renders inline; each product-results part → the matching card layout

   on refresh ──▶ GET /api/memory/threads/{id}/messages  (id read from /c/{id}) rehydrates the thread
                  AND the cards from the persisted results metadata (US-3.1, D12)
```

The supervisor **owns** the turn: it may run zero tool calls (a follow-up answered from memory), one, or
several (multi-intent, off-catalog merchandising). The cards are always **code-emitted by id**; the model
authors only prose — so grounding survives the agentic loop.

### The turn: a bounded supervisor loop (D15, D16)

```
load context  →  SUPERVISOR agent loop  →  persist
 (code, D12)       (gpt-5.4-mini)          (code, D12)
                       │
        ┌──────────────┼───────────────────────────┐
        ▼              ▼                             ▼
  find_products   recommend_product           compare_products
  (→ discovery     (spotlight 1 shown          (2 shown products
   finder agent)    product, by id)             side by side, by id)
```

- **supervisor** — one `gpt-5.4-mini` agent that drives everything: it decides *whether* to retrieve (a
  follow-up about products already on screen is answered from memory — no finder runs), calls
  `find_products` **once per distinct item**, reads each tool's lean summary, and writes the reply with
  per-item reasoning woven in. It holds Memory, so it persists the transcript (US-3.1) and learns durable
  preferences (US-7.1). It folds in the former orchestrator + generator + concierge roles (D15).
- **`find_products`** — for one shopping angle: drives the **discovery** finder sub-agent (see *Retrieval
  Strategy*). The finder selects products **by id**; code resolves ids → real `Product`s, enforces hard
  constraints, dedups against already-shown ids, computes the deterministic `relaxed` fact, **streams the
  cards**, and returns a lean narrative.
- **`recommend_product`** — spotlights **one** already-shown product with a badge (`recommended` /
  `best-value`) + a reason; renders as a hero card (US-2.2/2.3).
- **`compare_products`** — lays **two** already-shown products side by side as a spec table, optional
  `winnerId` (US-2.4).

**The loop is bounded in code, not by the model** (D15):
- `MAX_PRODUCT_FINDERS` — a run-local counter hard-stops once that many finders have actually run.
- `SUPERVISOR_MAX_STEPS` — a second counter increments on **every** tool call (including refused ones) and
  refuses past the cap, so the supervisor can't loop unbounded even if the framework's soft `maxSteps` is
  ignored. `FINDER_MAX_STEPS` bounds each inner finder.

Non-determinism is real (the supervisor genuinely decides), but every guarantee around it — **grounding by
construction** (the model only picks ids; code resolves real products and emits the cards; an unknown id is
refused, not invented — US-5.1), the caps, dedup/continuation, and persistence — is plain, testable code.

### Tech stack summary

| Concern | Choice | ADR |
|---------|--------|-----|
| Orchestration | Mastra (workflow shell + supervisor/finder agents + tools) | D7, D15 |
| LLM | OpenAI `gpt-5.4-mini` for both the supervisor and the discovery finder | D13, D15 |
| Storage | Mastra Memory on LibSQL (SQLite) | D4 |
| Front-end chat | Own Next.js App-Router UI (Tailwind, hand-built) | D8, D11 |
| Data layer | `@mastra/client-js` (browser → Mastra endpoints) | D8, D11 |
| Transport | Mastra workflow stream (text + custom data parts) | D6, D7 |
| Routing | URL `/c/{id}` = Mastra thread id | D5 |
| Host | Mastra server (built bundle) + standalone Next.js client | D1, D9, D11 |
| Catalog | DummyJSON Products API | — |
| Validation | Zod via `@bazak/shared` (server emits, client re-validates) | D11 |
| Observability | Mastra Studio + OpenTelemetry + PinoLogger | D7 |
| Testing / eval | Vitest (`shared`/`server`) + Jest/RTL (`frontend`); Mastra LLM-judge evals (`server/evals`) | D10 |

---

## Retrieval Strategy

### How intent becomes API requests

The supervisor turns a user message into one **brief per shopping angle** and calls `find_products` for
each. Each call hands the **discovery** finder a rich natural-language brief plus short keywords (1–2 core
nouns), an optional real category slug, and **only** the price/rating/brand bounds the user actually stated
— it never invents a constraint. The finder then drives two scoped catalog tools to retrieve real products
and selects them **by id**; code resolves those ids to real catalog records (grounding).

### Which DummyJSON endpoints + parameters, and why

DummyJSON has **no server-side filter** for price, rating, brand, or stock — only keyword `q`,
`category/{slug}`, `sortBy`/`order`, and `limit`/`skip` (US-1.2). So every retrieval is:

```
pick the best tool/endpoint  →  fetch  →  filter unsupported attributes client-side  →  sort  →  paginate
 (search vs category)                       (price / rating / brand / stock)
```

| Need | Endpoint | Query params used | Then, client-side |
|------|----------|-------------------|-------------------|
| Keyword / free-text (`product_search` tool) | `GET /products/search?q=` | `q` (short noun), `limit`/`skip`, `sortBy`/`order` | filter price/rating/brand/stock; sort; page |
| Browse a category (`category_browse` tool) | `GET /products/category/{slug}` | `limit`/`skip`, `sortBy`/`order` | same |
| Resolve a category name | `GET /products/categories` (+ counts) | — | map user term → real slug (US-1.6) |
| Single product detail (future) | `GET /products/{id}` | — | deferred (FUTURE.md) |

`q` is kept to a short noun because the catalog does **naive substring matching** (long descriptive phrases
match nothing). Price/rating/brand/stock are filtered **client-side** because DummyJSON can't; `sortBy`/`order`
surface the best of a relaxed set (`price` asc for cheapest, `rating` desc for most popular); `limit`/`skip`
bound the fetched window.

**The finder batches retrieval, then relaxes by *adding angles* — not loosening one query in place.** On its
**first step** the finder fires **several tool calls in parallel** (so it sees every angle at once) —
typically three together: the **focused** search (core noun + every constraint, incl. any soft price cap);
a **price-relaxed** search (same noun, soft cap dropped, sorted `price` asc — the cheapest options just over
budget); and a **wider** search (`category_browse` on the best-fit slug, and/or a broader keyword). It then
reads the match counts: if the focused set is healthy it returns just that group and **discards the
fallbacks**; if it's too thin, it returns **every distinct relaxed angle the buyer can self-select between**
— the standard fallback is two groups, *"cheapest `<noun>`, a bit over budget"* and *"closest matches in
`<category>`"*, each carrying its deterministic `relaxed`/dropped-constraint fact for honest framing.
**Hard constraints are never relaxed** (D13).

The **24 real catalog categories** (with per-category item counts) are fetched once and cached 24h, then
injected as **prompt text** into the supervisor and finder so they route against *real* slugs and broaden
when a best-fit category is thin (D13). **Pagination** and **"show me more"** (US-1.4/1.5) exclude every
**already-shown id** (loaded from persisted metadata, D12) from each finder call, so follow-ups page forward
with no repeats (D14, now enforced inside the loop, D15). Availability/deals (US-1.7) come from
`stock`/`availabilityStatus` and `discountPercentage`.

### Behavior on hard cases

- **Ambiguous (e.g. "something cheap and cool")** — the supervisor does **not** invent a price ceiling or a
  subjective filter and does **not** ping-pong for clarification. "cheap" sorts by price (no hard cap unless
  stated); for a quality the catalog has **no data for** ("cool", "durable", "reliable") it runs one broad
  search sorted by `rating`, **shows** the strongest general options, and is **upfront** that it can't verify
  that attribute — it never labels the list as meeting it. For "help me choose" among products already shown,
  it spotlights one (`recommend_product`) or compares two (`compare_products`).
- **Off-catalog (e.g. "a flight to Tokyo")** — we don't sell it. The supervisor still **merchandises**:
  a few `find_products` calls for adjacent things the trip plausibly needs (a bag, headphones, sunglasses)
  against real slugs, then in the reply **declines the literal request honestly** — it never claims these
  items *are* the flight (US-4.2).
- **Multi-intent (e.g. "a phone and a laptop bag")** — one `find_products` call per distinct item, producing
  one `product-results` group each (US-1.3). A single need is one call — it is not split to pad "more
  options" of the same thing.

---

## Conversation & State Management

### Where persistence lives, and why

All conversation state is **server-side** in **Mastra Memory on LibSQL** (embedded SQLite) — **threads**
hold the message transcript (list / resume / search out of the box, US-3.x) and **working memory** holds a
durable, per-user preferences doc (D4). The browser holds **only the conversation id, in the URL** `/c/{id}`
(= the Mastra thread id, D5); on refresh it re-fetches by id. **Why Mastra Memory:** we already commit to
Mastra for orchestration, so letting it own persistence removes an entire hand-rolled transcript +
list/search layer and delivers the personalization loop (working memory) at near-config cost; LibSQL is a
single local file (no separate DB to run). Each assistant turn also persists its **results + chips + finders
as message metadata** (D12) so a refresh rehydrates the **cards**, not just the prose.

```
resource (user)                      ← one, fixed, for the local app
 ├── working memory  { prefs… }       ← per-user; DURABLE prefs only; survives across conversations (US-7.1)
 └── threads[]                        ← one per conversation
      └── messages[]  { role, parts, createdAt, metadata? }   ← the transcript (US-3.1);
                                         assistant messages carry per-turn results + chips +
                                         finders in metadata (D12) for resume / "show me more"
```

### HTTP / streaming API

The client uses **Mastra's built-in endpoints** (D9) plus exactly **one** custom route; it never calls
OpenAI or DummyJSON directly.

| Method & path | Purpose |
|---------------|---------|
| `POST /api/workflows/pipeline/stream` | Run a turn: the supervisor loop, **streaming** text + `product-results` parts. `inputData: { message, threadId, resourceId }` |
| `POST /api/memory/threads?agentId=supervisor` | Create a conversation (thread) |
| `GET /api/memory/threads?resourceId=…` · `GET /api/memory/threads/{id}` | List / resume conversations |
| `GET /api/memory/threads/{id}/messages` | Full history (rehydrate on refresh) |
| `DELETE /api/memory/threads/{id}` | Delete a conversation |
| `GET`/`DELETE /profile` *(custom route, D9a)* | Read / reset remembered preferences (working memory) |

The **streaming response** carries `data-product-results` parts (one per group, each
`{ intent, products, display?, badge?, winnerId?, rationale? }`, `display` ∈ `grid`/`recommendation`/`comparison`)
emitted mid-turn via `writer.custom(...)`, then a final `{ message, results, chips }`. Prose is not
token-streamed (cards stream mid-turn, prose lands at the end). Conversation search (US-3.4) is client-side
(filter the thread list by title) — there's no built-in text-search endpoint.

### Failure scenarios

- **Storage quota / disk-write failure** — LibSQL is durable SQLite (WAL, atomic commits); a write/disk
  error is caught and surfaced as a **friendly fallback + next step**, never a raw DB error (US-5.2). The
  turn's reply still streams; only resume fidelity degrades (the cards may not persist), not the live turn.
- **Corrupted state** — history load (`loadThreadContext`) is **best-effort**: any read/parse failure falls
  back to an **empty context** rather than crashing, and metadata is validated defensively (array/shape
  checks) before use. The grounding registry only trusts well-formed persisted products, so a corrupt record
  is skipped, not rendered.
- **User clears storage mid-conversation** — because state is **server-side** and the pointer is the URL,
  clearing **browser** storage loses nothing: a refresh re-fetches the thread by id. If the **server** store
  is reset (delete the thread, or `DELETE /profile` to wipe working memory), the app degrades to a clean
  slate — empty history / no remembered prefs — and the next turn simply starts fresh.

---

## Evaluation Strategy

Two layers, both on the ESM-native stack (Vitest server/shared, Jest + RTL frontend — D10):

- **Unit / integration (`npm test`)** — fast, deterministic, no model/network. Covers the pure, injectable
  seams: retrieval filter/sort/paginate, hard-constraint enforcement, the relaxed-fact computation, chips,
  supervisor/tool wiring, the stream parser, and frontend components/mappers. A turn can run with **fake
  agents** so the orchestration is exercised without a model call. The shared Zod schemas are the seam — the
  server validates what it emits and the frontend re-validates the same shapes, so the two can't drift.
- **LLM-as-judge evals (`npm run eval`)** — end-to-end. Each scenario is driven through the **real
  `pipeline`** (real supervisor + finder + **live catalog**) inside an **isolated in-memory Mastra instance**
  (never the prod DB), then the turn's **trace** (reply + tool calls + cards) is graded by an **independent,
  stronger judge model** (`gpt-5.4`, vs the system's `gpt-5.4-mini`, to avoid self-eval bias) via Mastra's
  `createScorer`/`@mastra/evals`, alongside deterministic zero-LLM **tool-usage checks**.

**What's validated end-to-end:** the supervisor's *decisions* — correct tool choice (searching when it
should, **not** re-searching when it can answer from context, declining out-of-scope without tools),
grounding (no product/attribute it didn't actually retrieve), honest relaxation/declines, and no repeats on
"show me more".

**Regressions this catches:** a prompt edit that breaks tool choice, a grounding violation, a missing
off-catalog decline, failure to relax when results are thin, repeats on pagination, or schema drift at the
FE/BE seam.

**What can still slip through:** subjective reply quality/tone; latency and cost (not asserted); **live
DummyJSON drift** (the catalog can change under the eval); judge non-determinism/bias; anything outside the
scenario set; long-horizon multi-turn memory issues; and visual/UX regressions beyond component tests.

---

## Known Limitations

- **Prose vs. cards** — cards are authoritative (code-emitted, by id), but the supervisor's *prose* is
  grounded only by the lean summary the tools return, so it could mis-state a detail in text. Mitigated by
  keeping all hard data on the cards.
- **Latency / cost** — a turn can be a few sequential finder calls, and prose is **not** token-streamed (it
  lands at the end). There is no latency budget / per-call timeout yet (FUTURE.md).
- **Grounding-registry recall window** — recommend/compare can only ground products within the recall window
  (`perPage: 10`); a reference to something shown far earlier is **refused rather than guessed** (grounding
  over reach).
- **Retrieval is window-bounded** — client-side filtering runs over a fetched page, not the whole catalog,
  so very broad filtered queries are approximate.
- **Local single-user assumptions** — no auth, no rate-limiting, and only a **basic** stay-in-lane /
  prompt-injection refusal (the app runs locally with the developer's own key — FUTURE.md *Security & Abuse*).
- **No product-detail view, no ranking-personalization, no analytics**, and chips are basic (FUTURE.md).
- **No conversation management in the UI** — the server supports deleting a thread
  (`DELETE /api/memory/threads/{id}`), but the UI doesn't yet surface **"delete conversation"** or a
  **"delete all conversations"** action, so clearing history means calling the endpoint directly.
- **No response feedback (like / unlike)** — there's no thumbs-up/down on an assistant reply. Beyond the
  UX gap, this is a missed **evaluation** signal: captured likes/unlikes would seed new real-world scenarios
  for the LLM-judge eval suite over time (turning live feedback into regression cases).
- **With another week:** add a latency budget + timeouts and token-stream the prose; a product-detail
  ("tell me more") view; **delete-conversation + delete-all actions** in the UI; a **like/unlike feedback
  loop** that feeds new eval scenarios; fold remembered preferences into retrieval ranking; an analytics/eval
  dashboard and broader eval scenario coverage; and auth + rate-limiting if it ever goes multi-tenant.
