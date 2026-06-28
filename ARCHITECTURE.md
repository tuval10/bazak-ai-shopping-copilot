# Architecture — Bazak AI Shopping Copilot

The system picture in one place: the layers, how a turn flows end-to-end, the pipeline, the retrieval
strategy, the HTTP/streaming API, the data model, and the tech stack. This doc says *what the pieces
are and how they fit*; **[DECISIONS.md](DECISIONS.md)** says *why* each was chosen (referenced inline as
`Dn`), and **[USER_STORIES.md](USER_STORIES.md)** says *what behavior* they serve (referenced as `US-x`).

---

## 1. System overview

```
┌───────────────────────────────────────────────────────────────────────────┐
│  BROWSER                                                                    │
│  assistant-ui chat shell (D8)                                               │
│    • thread · composer · streaming · autoscroll · edit/regenerate           │
│    • makeAssistantToolUI("product-results") → <ProductCardGroup/>  (D6)      │
│  holds only the conversation id, in the URL  /c/{id}  (D5)                   │
└──────────────▲────────────────────────────────────────┬────────────────────┘
               │ AI SDK v5 stream (SSE):                 │ fetch:
               │ assistant text + product-results parts  │ create / list / load
┌──────────────┴────────────────────────────────────────▼────────────────────┐
│  LOCAL SERVER  —  thin backend, Next.js route handlers  (D1, D3)            │
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
| Front-end | **assistant-ui** | Chat shell (thread/composer/streaming/autoscroll); renders streamed `product-results` parts as product-card groups via `makeAssistantToolUI` | D8, D6 |
| Transport | **`@mastra/ai-sdk` → AI SDK v5 stream (SSE)** | Streams assistant text + typed parts to the client | D6, D7 |
| Host | **Next.js route handlers** | Serves the client and the JSON/streaming API; keeps the OpenAI key server-side | D1, D3 |
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
   5. generate    ├─ gpt-5.4-mini: STREAM assistant text
                  │     + emit one "product-results" part per intent (grounded only in retrieved data, US-5.1)
                  │     + update working memory if new prefs surfaced (US-7.1)
   6. persist     ├─ Mastra Memory: append user + assistant messages to the thread
                  ▼
   stream ──▶ assistant-ui: text renders inline; each product-results part → <ProductCardGroup/>

   on refresh ──▶ GET /api/memory/threads/{id}/messages  (id read from /c/{id}) rehydrates the thread (US-3.1)
```

Two LLM calls per turn (classify, generate); everything between is plain, testable code (D2). The pipeline
— not the model — produces product results, so the generate step **writes them onto the stream as
synthetic tool/data parts** (D6).

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
> server with `npm run dev` (Mastra Studio) or `npm start` (build + run) — both serve every endpoint.

**Conversation search (US-3.4)** is **client-side** — there is no built-in thread text-search endpoint,
so the client filters the thread list by title.

**Identity:** for a single-user local app, there is one fixed Mastra **`resourceId`** (the user); each
conversation is a **`threadId`** scoped to it. Working memory is scoped to the resource, so preferences
persist across all of that user's conversations (US-7.1).

**Streaming response** (from the messages endpoint) is an AI SDK v5 stream carrying:
- **text parts** — the assistant's natural-language summary, rendered inline;
- **`product-results` parts** — one per intent, each `{ intent, products: [...] }`, rendered as a
  product-card group (D6). Multi-intent → multiple parts; single intent → one.

Each product carries the catalog fields the card needs: `id`, `title`, `description`, `price`,
`discountPercentage`, `rating`, `stock`, `availabilityStatus`, `thumbnail` (US-2.1, US-1.7).

---

## 7. Data model (Mastra Memory / LibSQL — D4)

```
resource (user)                      ← one, fixed, for the local app
 ├── working memory  { prefs… }       ← per-user; structured doc; survives across conversations (US-7.1)
 └── threads[]                        ← one per conversation
      └── messages[]  { role, parts, createdAt }   ← the transcript (US-3.1)
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
| Front-end chat | assistant-ui | D8 |
| Transport | SSE via `@mastra/ai-sdk` → AI SDK v5 stream | D6, D7 |
| Routing | URL `/c/{id}` = Mastra thread id | D5 |
| Host framework | Next.js route handlers | D1, D3 |
| Catalog | DummyJSON Products API | — |
| Validation | Zod (via Mastra / AI SDK structured output) | D2 |
| Observability | Mastra Studio + OpenTelemetry | D4, D7 |

---

## 10. Open items (not yet ADR'd)

- **Host framework** — Next.js full-stack is the working assumption (natural fit for a React FE + thin
  backend + SSE), implied by D1/D3 but not its own decision entry. A standalone Node server is the
  alternative if we want the FE fully decoupled.
- **Test / eval tooling** — the *what* is fixed (US-6.1: end-to-end flow + Epic 4 edge cases, on a
  per-turn log); the concrete runner (Mastra evals + a test framework) is still to be pinned down.
