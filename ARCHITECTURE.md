# Architecture — Bazak AI Shopping Copilot

The system picture in one place: the layers, how a turn flows end-to-end, the pipeline, the retrieval
strategy, the HTTP/streaming API, the data model, and the tech stack. This doc says *what the pieces
are and how they fit*; **[DECISIONS.md](DECISIONS.md)** says *why* each was chosen (referenced inline as
`Dn`), and **[USER_STORIES.md](USER_STORIES.md)** says *what behavior* they serve (referenced as `US-x`).

---

## 1. System overview

```
┌───────────────────────────────────────────────────────────────────────────┐
│  BROWSER  —  own Next.js App-Router UI (D8, D11), client-side only          │
│    • hand-built chat shell: thread · composer · streaming · autoscroll      │
│    • <ProductResults> renders streamed product-results parts  (D6)          │
│    • @mastra/client-js talks straight to the server (no FE backend)         │
│  holds only the conversation id, in the URL  /c/{id}  (D5)                   │
└──────────────▲────────────────────────────────────────┬────────────────────┘
               │ workflow stream:                        │ client-js fetch:
               │ assistant text + product-results parts  │ create / list / load
┌──────────────┴────────────────────────────────────────▼────────────────────┐
│  LOCAL SERVER  —  Mastra server (built bundle, port 4111)  (D1, D7, D9)     │
│  owns:  OpenAI key  ·  orchestration  ·  persistence                        │
│                                                                             │
│  ┌─ Mastra workflow  =  the D2 pipeline ───────────────────────────────┐    │
│  │  classify+extract  →  route  →  plan+retrieve  →  generate           │    │
│  │      (nano)                                       (mini, streams)    │    │
│  └────────▲────────────────────────────────────────────────┬───────────┘    │
│           │ history + working memory                        │ catalog calls  │
│  ┌────────┴───────────────────┐               ┌─────────────▼────────────┐   │
│  │ Mastra Memory  (LibSQL)    │               │ DummyJSON client          │   │
│  │  • threads  → transcript   │               │  pick endpoint → fetch    │   │
│  │  • working memory → prefs  │               │  → filter / sort / page   │   │
│  └────────────────────────────┘               └──────────────────────────┘   │
└──────────────────────────────────────────────────────────┬──────────────────┘
                                                            │ HTTPS
                       ┌────────────────────────────────────┴──────────────────┐
                       │  OpenAI API                  │  DummyJSON Products API   │
                       │  gpt-5.4-nano / gpt-5.4-mini  │  (read-only catalog)      │
                       └───────────────────────────────┴───────────────────────────┘
```

The browser is a **thin client** (D1): it holds only the conversation id and renders what it's streamed.
All orchestration, the OpenAI key, and all persistence live on the local server.

---

## 2. Components & responsibilities

| Layer | Component | Responsibility | ADR |
|------|-----------|----------------|-----|
| Front-end | **Own Next.js App-Router UI** | Hand-built chat shell (thread/composer/streaming/autoscroll); `<ProductResults>` renders streamed `product-results` parts as product-card groups | D8, D11, D6 |
| Data layer | **`@mastra/client-js`** | Browser client to the Mastra endpoints (workflow stream + memory threads + `/profile`); responses validated against `@bazak/shared` | D8, D11 |
| Transport | **Mastra workflow stream** | Streams assistant text + custom `data-product-results` parts to the client | D6, D7 |
| Host | **Mastra server** (built bundle) | Serves the streaming + memory-thread + profile endpoints; keeps the OpenAI key server-side | D1, D9 |
| Orchestration | **Mastra workflow** (the D2 pipeline) | Deterministic `classify → route → retrieve → generate`; agents back only the two LLM steps | D2, D7 |
| Storage | **Mastra Memory on LibSQL** | Threads (conversation transcript) + working memory (per-user prefs) | D4 |
| External | **OpenAI** | `gpt-5.4-nano` (classify/extract) · `gpt-5.4-mini` (generate) | D2 |
| External | **DummyJSON Products API** | Read-only product catalog | — |

---

## 3. Request lifecycle — one turn, end to end

```
user types ──▶ POST /api/workflows/{id}/stream   { inputData: { message, threadId, resourceId } }
                  │
   1. load        ├─ Mastra Memory: fetch thread history + working memory (by resource+thread)
   2. classify    ├─ gpt-5.4-nano: intent type(s), extracted attributes, multi-intent split (US-1.2/1.3)
   3. route       ├─ branch: chit-chat | off-catalog | ambiguous | product search (Epic 4)
   4. retrieve    ├─ per sub-intent: pick DummyJSON endpoint → fetch → filter/sort/paginate client-side
   5. generate    ├─ emit one "product-results" part per intent (grounded only in retrieved data, US-5.1)
                  │     + gpt-5.4-mini: write the assistant summary text
                  │     + update working memory if new prefs surfaced (US-7.1)
   6. persist     ├─ Mastra Memory: append user + assistant messages to the thread;
                  │     store the per-turn results as assistant-message metadata (D12) for resume
                  ▼
   stream ──▶ own UI: text renders inline; each product-results part → <ProductResults> card group

   on refresh ──▶ GET /api/memory/threads/{id}/messages  (id read from /c/{id}) rehydrates the thread
                  AND the cards from the persisted results metadata (US-3.1, D12)
```

Two LLM calls per turn (classify, generate); everything between is plain, testable code (D2). The pipeline
— not the model — produces product results, so the generate step **writes them onto the workflow stream as
custom data parts** (D6).

---

## 4. The orchestration pipeline (D2)

```
classify + extract  →  route  →  plan + retrieve  →  generate
   (LLM, nano)       (code)        (code + API)      (LLM, mini)
```

- **classify + extract** — one `gpt-5.4-nano` call: detect intent type, extract attributes
  (category, price range, brand, rating, keywords), and split multi-intent messages into single queries
  (US-1.2, US-1.3).
- **route** — deterministic branch on intent: chit-chat (US-4.3), off-catalog (US-4.2),
  ambiguous/subjective (US-4.1), or product search. No model call.
- **plan + retrieve** — for each sub-intent, run the retrieval strategy (§5). No model call.
- **generate** — one `gpt-5.4-mini` call: write the assistant summary and stream the per-intent
  `product-results` parts, grounded strictly in what retrieval returned (US-5.1). Also persists any newly
  stated preferences to working memory (US-7.1).

Non-determinism is boxed into exactly the two LLM steps; every arrow between them is a testable seam (US-6.1).

---

## 5. Retrieval strategy (DummyJSON reality)

DummyJSON has **no server-side filter** for price, rating, brand, or stock — only keyword `q`,
`category/{slug}`, `sortBy`/`order`, and `limit`/`skip` (US-1.2). So retrieval is always:

```
pick the best endpoint  →  fetch  →  filter unsupported attributes client-side  →  sort  →  paginate
 (search vs category)                 (price / rating / brand / stock)
```

| Need | Endpoint | Then, client-side |
|------|----------|-------------------|
| Keyword / free-text | `GET /products/search?q=` | filter price/rating/brand/stock; sort; page |
| Browse a category | `GET /products/category/{slug}` | same |
| Resolve a category name | `GET /products/categories` | map user term → real slug (US-1.6) |
| Single product detail (future) | `GET /products/{id}` | — (deferred, FUTURE.md) |

Pagination (US-1.4) is `limit`/`skip` carried in conversation context, not a re-run of the query.
Availability and deals (US-1.7) are read from `stock`/`availabilityStatus` and `discountPercentage`.

---

## 6. API surface

The client uses **Mastra's built-in endpoints** (D9); the server adds exactly **one** custom route for
the working-memory gap. The client never calls OpenAI or DummyJSON directly.

| Method & path | Purpose | Stories |
|---------------|---------|---------|
| `POST /api/workflows/{id}/stream` | Run a turn: the pipeline workflow, **streaming** assistant text + `product-results` parts. `inputData: { message, threadId, resourceId }` | US-1.x, US-4.x, US-7.x |
| `POST /api/memory/threads?agentId=generator` | Create a conversation (thread) — thread ops are scoped to an agent's memory | US-3.2 |
| `GET /api/memory/threads?resourceId=…` | List conversations (by `resourceId`) | US-3.3 |
| `GET /api/memory/threads/{id}` | Thread metadata (resume) | US-3.3 |
| `GET /api/memory/threads/{id}/messages` | Full message history (rehydrate on refresh) | US-3.1 |
| `DELETE /api/memory/threads/{id}` | Delete a conversation | — |
| `GET /profile` *(custom route, D9a)* | Read-only view of remembered preferences (working memory) | US-7.4 |
| `DELETE /profile` *(custom route, D9a)* | Reset / clear remembered preferences | US-7.4 |

> Custom routes can't live under `/api` (reserved by Mastra), so the profile route is `/profile`. Run the
> server with `npm start` (build + run), not `mastra dev` — see DECISIONS D9a "Studio caveat".

**Conversation search (US-3.4)** is **client-side** — there is no built-in thread text-search endpoint,
so the client filters the thread list by title.

**Identity:** for a single-user local app, there is one fixed Mastra **`resourceId`** (the user); each
conversation is a **`threadId`** scoped to it. Working memory is scoped to the resource, so preferences
persist across all of that user's conversations (US-7.1).

**Streaming response** (from `POST /api/workflows/{id}/stream`) is a workflow stream of chunks carrying:
- **`data-product-results` parts** — one per intent, each `{ intent, products: [...] }`, streamed via
  `writer.custom(...)` as each intent resolves and rendered as a product-card group (D6). Multi-intent →
  multiple parts; single intent → one.
- **the final step output** — `{ message, results }`: the assistant's natural-language summary (rendered
  inline) plus the aggregate results. Prose is **not** token-streamed (the generate step returns full
  text); cards stream mid-turn, prose lands at the end.

Each product carries the catalog fields the card needs: `id`, `title`, `description`, `price`,
`discountPercentage`, `rating`, `stock`, `availabilityStatus`, `thumbnail` (US-2.1, US-1.7).

---

## 7. Data model (Mastra Memory / LibSQL — D4)

```
resource (user)                      ← one, fixed, for the local app
 ├── working memory  { prefs… }       ← per-user; structured doc; survives across conversations (US-7.1)
 └── threads[]                        ← one per conversation
      └── messages[]  { role, parts, createdAt, metadata? }   ← the transcript (US-3.1);
                                         assistant messages carry per-turn results in metadata (D12)
```

- **threads** give conversation list / resume / search out of the box (US-3.3, US-3.4).
- **working memory** is a single structured per-user doc — easy to render read-only and to reset (US-7.4).
- **semantic recall** (vector search over messages via LibSQL + FastEmbed) is available for the agentic
  future we're future-proofing for (D7); messages already live in the store.

LibSQL is durable embedded SQLite (WAL, atomic commits); storage errors are handled gracefully and never
surfaced as a raw DB error (US-5.2).

---

## 8. Cross-cutting concerns

- **Grounding (US-5.1)** — enforced server-side in *generate*: only products actually returned by
  retrieval are ever emitted. No invented products, prices, or specs.
- **Graceful failure (US-5.2)** — catalog/model/store errors return a friendly fallback + next step;
  partial multi-intent failures return what succeeded and flag what didn't.
- **Personalization (Epic 7)** — preferences are learned implicitly into working memory and sit in the
  model's context at generate time; an explicit in-turn request overrides a stored preference (US-7.2).
- **Observability** — Mastra Studio + OpenTelemetry give step-level traces of each run (D4, D7); a
  lightweight per-turn log feeds evaluation (US-6.1).

---

## 9. Tech stack summary

| Concern | Choice | ADR |
|---------|--------|-----|
| Orchestration | Mastra (workflow + agents) | D2, D7 |
| LLM | OpenAI `gpt-5.4-nano` (classify) · `gpt-5.4-mini` (generate) | D2 |
| Storage | Mastra Memory on LibSQL (SQLite) | D4 |
| Front-end chat | Own Next.js App-Router UI (Tailwind, hand-built) | D8, D11 |
| Data layer | `@mastra/client-js` (browser → Mastra endpoints) | D8, D11 |
| Transport | Mastra workflow stream (text + custom data parts) | D6, D7 |
| Routing | URL `/c/{id}` = Mastra thread id | D5 |
| Host | Mastra server (built bundle) + standalone Next.js client | D1, D9, D11 |
| Catalog | DummyJSON Products API | — |
| Validation | Zod via `@bazak/shared` (server emits, client re-validates) | D2, D11 |
| Observability | Mastra Studio + OpenTelemetry | D4, D7 |

---

## 10. Open items (not yet ADR'd)

- *(resolved)* **Host framework** — settled: a standalone **Mastra server** (built bundle) owns the API,
  and the frontend is a **separate client-only Next.js app** on `@mastra/client-js` (D8, D9, D11). The two
  are fully decoupled; there is no FE backend.
- *(resolved)* **Test / eval tooling** — Vitest on `shared`/`server` (D10), Jest + RTL on `frontend`
  (D11); Epic 4 edge cases run as server evals.
