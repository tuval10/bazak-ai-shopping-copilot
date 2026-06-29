# Architecture — Bazak AI Shopping Copilot

The system picture in one place: the layers, **why we built it on Mastra**, how a turn flows end-to-end,
the retrieval strategy, the HTTP/streaming API, the data model, and the tech stack. This doc says *what the
pieces are and how they fit*; **[DECISIONS.md](DECISIONS.md)** says *why* each was chosen (referenced
inline as `Dn`), and **[USER_STORIES.md](USER_STORIES.md)** says *what behavior* they serve (referenced as
`US-x`).

---

## 1. System overview

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
code enforces every invariant (grounding, caps, dedup, persistence); see §2 and §5.

---

## 2. Framework choice — why Mastra

> Answers the assignment's *Architecture & Framework Choice* question. The full ADR is **D7**
> (framework), with the agentic shape in **D15/D16**.

The orchestration layer is built on **[Mastra](https://mastra.ai)** — a TypeScript-native framework that
bundles **agents + tools + workflows + memory + tracing + evals** on top of the Vercel AI SDK. Four
properties decided it, each tied to a concrete requirement of *this* assignment:

**1. Memory out of the box (the persistence + personalization requirement).** Mastra Memory gives us, with
near-zero code: **threads** (the conversation transcript, plus list / resume / search — US-3.x) and
**working memory** (a durable, per-user preferences doc — Epic 7), backed by embedded **LibSQL** (SQLite).
Conversation storage *and* the personalization loop come from one store instead of two hand-rolled layers
(D4). **Semantic recall** (vector search over messages) sits in the same store for later.

**2. A dev platform: tracing & observability (the debugging requirement).** Mastra
Studio + OpenTelemetry give **step-, agent-, and tool-level traces of every run** — you can watch the
supervisor decide, each `find_products` call, and each inner search/browse the finder makes. This stopped
being a nice-to-have the moment the turn became an agentic loop: a multi-round, model-driven turn is only
defensible if you can *see* every tool call it made.

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
bolted-on harness. This matters *more* for an agentic loop than for a deterministic pipeline: once the
model decides the control flow, evals are how you keep it honest as prompts evolve. We're actively
building these out on the supervisor turn.

**Alternatives considered and why they were rejected here:**

| Alternative | Why rejected for *this* assignment |
|-------------|------------------------------------|
| **Vercel AI SDK direct** | The lightest option, and Mastra is built *on* it (so we keep its streaming at the UI edge either way). But it ships no Studio/tracing, no first-class evals, no Memory primitive, and no workflow engine — we'd hand-roll persistence, working memory, and the bounded-loop shell ourselves. The honest fallback only if the flow had stayed non-agentic. |
| **LangChain / LangGraph (JS)** | Powerful graph + durable checkpoints, but Python-first with grafted TS that trails releases, heavier, and a weaker local/serverless story. Overkill for a single-user local app. |
| **Fully custom orchestration** | Maximum control, but reinvents the orchestration, streaming, memory, and tracing Mastra gives for free — exactly the plumbing we'd rather not own and defend. |

> **Note on "not a single agent":** we deliberately did **not** ship a bare single-agent-with-tools loop
> (non-deterministic, hard to eval). What we ship is a **bounded** agent loop *inside* the workflow shell,
> with grounding and caps enforced in code (D15) — agentic flexibility without losing the testable seams.
> Mastra is what makes that hybrid clean.

**Alternatives for the front-end** (a separate choice — the *chat UI*, not the orchestration framework;
see **D8/D11**). We built our own small chat shell on `@mastra/client-js` rather than adopt a UI framework:

| Alternative | Why rejected for *this* assignment |
|-------------|------------------------------------|
| **assistant-ui** | Every official assistant-ui ⇄ Mastra path assumes an **agent** stream, not our **workflow** stream; its card-rendering API is deprecated; and our cards are a server-produced **data part**, not a model tool-call — so the integration cost exceeded the shell it would have saved (D8). |
| **CopilotKit** | Built to bolt a copilot **onto an existing app**; wrong shape for a chat-first app (D8). |
| **LibreChat** | A finished self-hosted chat *product*; wrong shape for a bespoke discovery UI with custom cards and our own persistence (D7). |

---

## 3. Components & responsibilities

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

---

## 4. Request lifecycle — one turn, end to end

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
authors only prose — so grounding survives the agentic loop (§5, §9).

---

## 5. The turn: a bounded supervisor loop (D15, D16)

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
- **`find_products`** — for one shopping angle: drives the **discovery** finder sub-agent, which uses the
  `product_search` (keyword) and `category_browse` (slug) tools to retrieve and, when too few match,
  **relax** (broaden a keyword / browse a category / drop a *soft* constraint). The finder selects products
  **by id**; code resolves ids → real `Product`s, enforces hard constraints, dedups against already-shown
  ids, computes the deterministic `relaxed` fact, **streams the cards**, and returns a lean narrative.
- **`recommend_product`** — spotlights **one** already-shown product with a badge (`recommended` /
  `best-value`) + a reason; renders as a hero card (US-2.2/2.3).
- **`compare_products`** — lays **two** already-shown products side by side as a spec table, optional
  `winnerId` (US-2.4).

**The loop is bounded in code, not by the model** (D15):
- `MAX_PRODUCT_FINDERS` — a run-local counter hard-stops once that many finders have actually run (the
  catalog-cost ceiling).
- `SUPERVISOR_MAX_STEPS` — a second counter increments on **every** tool call (including refused ones) and
  refuses past the cap, so the supervisor can't loop unbounded even if the framework's soft `maxSteps` is
  ignored. `FINDER_MAX_STEPS` bounds each inner finder.

Non-determinism is real (the supervisor genuinely decides), but every guarantee around it — grounding by
id, the caps, dedup/continuation, persistence — is plain, testable code (US-6.1). The eval suite injects
fake agents at the same seams.

---

## 6. Retrieval strategy (DummyJSON reality)

DummyJSON has **no server-side filter** for price, rating, brand, or stock — only keyword `q`,
`category/{slug}`, `sortBy`/`order`, and `limit`/`skip` (US-1.2). The discovery finder drives two scoped
tools that wrap this; either way retrieval is:

```
pick the best tool/endpoint  →  fetch  →  filter unsupported attributes client-side  →  sort  →  paginate
 (search vs category)                       (price / rating / brand / stock)
```

| Need | Endpoint | Then, client-side |
|------|----------|-------------------|
| Keyword / free-text (`product_search` tool) | `GET /products/search?q=` | filter price/rating/brand/stock; sort; page |
| Browse a category (`category_browse` tool) | `GET /products/category/{slug}` | same |
| Resolve a category name | `GET /products/categories` (+ counts) | map user term → real slug (US-1.6) |
| Single product detail (future) | `GET /products/{id}` | — (deferred, FUTURE.md) |

The **24 real catalog categories** (with per-category item counts) are fetched once and cached 24h, then
injected as **prompt text** into the supervisor and finder so they route against *real* slugs and broaden
when a best-fit category is thin (D13). The category list is never a raw endpoint tool — retrieval always
goes through the two scoped search tools.

Pagination (US-1.4) and **"show me more"** (US-1.5) are handled by **excluding already-shown ids**: every
product id shown in the thread is loaded from persisted metadata (D12) and excluded from every finder call,
so follow-ups page forward with no repeats (D14, now enforced inside the loop, D15). Availability and deals
(US-1.7) are read from `stock`/`availabilityStatus` and `discountPercentage`.

---

## 7. API surface

The client uses **Mastra's built-in endpoints** (D9); the server adds exactly **one** custom route for
the working-memory gap. The client never calls OpenAI or DummyJSON directly.

| Method & path | Purpose | Stories |
|---------------|---------|---------|
| `POST /api/workflows/pipeline/stream` | Run a turn: the supervisor loop, **streaming** assistant text + `product-results` parts. `inputData: { message, threadId, resourceId }` | US-1.x, US-2.x, US-4.x, US-7.x |
| `POST /api/memory/threads?agentId=supervisor` | Create a conversation (thread) — thread ops are scoped to an agent's memory | US-3.2 |
| `GET /api/memory/threads?resourceId=…` | List conversations (by `resourceId`) | US-3.3 |
| `GET /api/memory/threads/{id}` | Thread metadata (resume) | US-3.3 |
| `GET /api/memory/threads/{id}/messages` | Full message history (rehydrate on refresh) | US-3.1 |
| `DELETE /api/memory/threads/{id}` | Delete a conversation | — |
| `GET /profile` *(custom route, D9a)* | Read-only view of remembered preferences (working memory) | US-7.4 |
| `DELETE /profile` *(custom route, D9a)* | Reset / clear remembered preferences | US-7.4 |

> Custom routes can't live under `/api` (reserved by Mastra), so the profile route is `/profile`. Run the
> server with `npm run dev` (Mastra Studio) or `npm start` (build + run) — both serve every endpoint.

**Conversation search (US-3.4)** is **client-side** — there is no built-in thread text-search endpoint,
so the client filters the thread list by title.

**Identity:** for a single-user local app, there is one fixed Mastra **`resourceId`** (the user); each
conversation is a **`threadId`** scoped to it. Working memory is scoped to the resource, so preferences
persist across all of that user's conversations (US-7.1).

**Streaming response** (from `POST /api/workflows/pipeline/stream`) is a workflow stream of chunks carrying:
- **`data-product-results` parts** — emitted by the tools via `writer.custom(...)` as each group resolves.
  Each is `{ intent, products: [...], display?, badge?, winnerId?, rationale? }` where `display` is
  `grid` | `recommendation` | `comparison` (D16). Rendered as a card group / hero card / comparison table.
- **the final step output** — `{ message, results, chips }`: the supervisor's natural-language summary
  (rendered inline) plus the aggregate results and suggestion chips. Prose is **not** token-streamed (the
  step returns full text); cards stream mid-turn, prose lands at the end.

Each product carries the catalog fields the card needs: `id`, `title`, `description`, `price`,
`discountPercentage`, `rating`, `stock`, `availabilityStatus`, `thumbnail` (US-2.1, US-1.7).

---

## 8. Data model (Mastra Memory / LibSQL — D4)

```
resource (user)                      ← one, fixed, for the local app
 ├── working memory  { prefs… }       ← per-user; DURABLE prefs only; survives across conversations (US-7.1)
 └── threads[]                        ← one per conversation
      └── messages[]  { role, parts, createdAt, metadata? }   ← the transcript (US-3.1);
                                         assistant messages carry per-turn results + chips +
                                         finders in metadata (D12) for resume / "show me more"
```

- **threads** give conversation list / resume / search out of the box (US-3.3, US-3.4).
- **working memory** is a single structured per-user doc holding **durable preferences only** (name, a
  lasting budget, consistently favoured/disliked categories/brands) — never the current query (D4). Easy to
  render read-only and to reset (US-7.4).
- **semantic recall** (vector search over messages via LibSQL + FastEmbed) is available in the same store
  for deeper recall as the agentic flow grows (D7); messages already live there.

LibSQL is durable embedded SQLite (WAL, atomic commits); storage errors are handled gracefully and never
surfaced as a raw DB error (US-5.2).

---

## 9. Cross-cutting concerns

- **Grounding by construction (US-5.1)** — the model never *authors* product data. The finder selects, and
  recommend/compare reference, products **by id**; **code** resolves the real `Product` from a per-turn
  grounding registry (seeded from prior turns' persisted results, grown as `find_products` lands groups)
  and emits the card. An unknown id is refused, not invented. The supervisor's prose is grounded by the lean
  summaries the tools return — the **cards remain authoritative** (D15, D16).
- **Graceful failure (US-5.2)** — catalog/model/store errors return a friendly fallback + next step;
  partial multi-intent failures return what succeeded and flag what didn't.
- **Personalization (Epic 7)** — durable preferences are learned into working memory and sit in the
  supervisor's context; an explicit in-turn request overrides a stored preference (US-7.2).
- **Bounded agency** — the supervisor loop can't run away: `MAX_PRODUCT_FINDERS`, `SUPERVISOR_MAX_STEPS`,
  and `FINDER_MAX_STEPS` cap it in code regardless of model behavior (§5, D15).
- **Observability** — Mastra Studio + OpenTelemetry give step/agent/tool-level traces of each run; a
  PinoLogger (`@mastra/loggers`, `LOG_LEVEL`-gated) feeds evaluation (US-6.1, D13).

---

## 10. Tech stack summary

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
| Observability | Mastra Studio + OpenTelemetry + PinoLogger | D7, D13 |

---

## 11. Open items (not yet ADR'd)

- *(resolved)* **Host framework** — settled: a standalone **Mastra server** (built bundle) owns the API,
  and the frontend is a **separate client-only Next.js app** on `@mastra/client-js` (D8, D9, D11). The two
  are fully decoupled; there is no FE backend.
- *(resolved)* **Test / eval tooling** — Vitest on `shared`/`server` (D10), Jest + RTL on `frontend`
  (D11); Epic 4 edge cases run as server evals.
- *(resolved)* **Orchestration shape** — settled on the bounded supervisor loop (D15) with
  recommend/compare display variants (D16), superseding the earlier deterministic pipeline (D2) and the
  orchestrator-+-sub-agents hybrid (D13).
