# Project Structure — Bazak AI Shopping Copilot

The repository is a workspace of three packages, each with its own test suite:

- **`shared/`** — types + Zod schemas that are the contract between the other two.
- **`server/`** — the Mastra orchestration pipeline, catalog client, persistence, and HTTP/streaming API.
- **`frontend/`** — the assistant-ui chat app.

This implies a **decoupled** topology: a standalone Mastra/Node **server** and a separate **frontend**
app (resolving the standalone-server alternative noted in [ARCHITECTURE.md](ARCHITECTURE.md) §10, rather
than a single Next.js full-stack host). See [ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit and
[DECISIONS.md](DECISIONS.md) for why (`Dn`); story tags below are `US-x` from [USER_STORIES.md](USER_STORIES.md).

```
bazak-ai-shopping-copilot/
├── shared/        # contract: types + Zod schemas (consumed by server + frontend)
├── server/        # Mastra pipeline · catalog client · Mastra Memory · API
├── frontend/      # assistant-ui chat app
├── package.json   # workspace root (npm/pnpm workspaces)
└── *.md           # ARCHITECTURE / DECISIONS / USER_STORIES / FUTURE / STRUCTURE / README
```

---

## `shared/` — the contract

Schemas and inferred types both sides validate against. The `product-results` stream part (D6) and the
catalog `Product` shape live here so server and frontend can never drift.

```
shared/
├── src/
│   ├── schemas/
│   │   ├── product.ts          # Zod: catalog Product (id, title, description, price,
│   │   │                       #      discountPercentage, rating, stock, availabilityStatus,
│   │   │                       #      thumbnail, brand, category)              US-2.1, US-1.7
│   │   ├── product-results.ts  # Zod: ProductResultsPart { intent, products[] } — the D6 stream part
│   │   ├── conversation.ts     # Zod: ConversationSummary, MessageHistory      US-3.x
│   │   ├── profile.ts          # Zod: remembered-preferences (working memory)  US-7.x
│   │   └── api.ts              # request/response contracts for every endpoint (§6 of ARCHITECTURE)
│   ├── types/
│   │   └── index.ts            # z.infer types re-exported for TS consumers
│   └── index.ts               # barrel export
├── tests/
│   └── schemas.test.ts         # parse / default / round-trip / rejection unit tests
├── package.json
└── tsconfig.json
```

**Testing:** lightweight schema unit tests — valid input parses, invalid input is rejected, defaults
apply. No I/O.

---

## `server/` — orchestration + API

The deterministic D2 pipeline as a Mastra workflow, the DummyJSON retrieval client, and Mastra Memory.
The HTTP surface is **Mastra's built-in endpoints** (D9) — a turn is `POST /api/workflows/{id}/stream`,
conversations are `/api/memory/threads…` — so there is no hand-rolled API layer beyond the one custom
`profile` route.

```
server/
├── src/
│   ├── api/                    # only the ONE custom route (D9) — the rest is Mastra's built-in endpoints
│   │   └── profile.ts          # registerApiRoute GET / DELETE working memory   US-7.4
│   ├── mastra/
│   │   ├── index.ts            # Mastra instance: storage + memory + workflow registration
│   │   ├── memory.ts           # Mastra Memory: LibSQL, working memory, semantic recall   D4
│   │   └── agents/
│   │       ├── classifier.ts   # gpt-5.4-nano agent — classify + extract  D2
│   │       └── generator.ts    # gpt-5.4-mini agent — generate + emit product-results parts
│   ├── pipeline/               # the D2 workflow steps (classify → route → retrieve → generate)
│   │   ├── workflow.ts         # wires the steps; branch via route
│   │   ├── classify.ts         # step 1 — intent(s) + attributes + multi-intent split  US-1.2/1.3
│   │   ├── route.ts            # step 2 — branch: chitchat/off-catalog/ambiguous/product  Epic 4
│   │   ├── retrieve.ts         # step 3 — per-intent retrieval (§5)
│   │   └── generate.ts         # step 4 — stream text + product-results parts; grounded  US-5.1
│   ├── catalog/                # DummyJSON client + retrieval strategy (§5)
│   │   ├── client.ts           # search / category / categories / product endpoints
│   │   ├── filter.ts           # client-side price/rating/brand/stock filter (no server filter)
│   │   ├── sort.ts             # client-side sort + pagination (limit/skip)  US-1.4/1.5
│   │   └── categories.ts       # user term → real catalog slug              US-1.6
│   ├── config/
│   │   ├── models.ts           # model ids (nano / mini)
│   │   └── env.ts              # OPENAI_API_KEY, LibSQL url, etc.
│   └── index.ts               # server entry — mounts the API
├── tests/
│   ├── unit/                   # pure, deterministic seams (no network)
│   │   ├── route.test.ts
│   │   ├── catalog.filter.test.ts
│   │   ├── catalog.sort.test.ts
│   │   └── categories.test.ts
│   ├── integration/            # full pipeline with mocked OpenAI + DummyJSON
│   │   └── pipeline.test.ts    #   User Input → Intent → Retrieval → Generation  US-6.1
│   ├── evals/                  # edge-case evals: ambiguous/off-catalog/chitchat/no-results/follow-up
│   │   └── edge-cases.eval.ts  #   Epic 4 coverage                          US-6.1
│   ├── mocks/
│   │   ├── dummyjson.ts        # canned catalog responses
│   │   └── openai.ts           # canned model outputs (classify + generate)
│   └── fixtures/
│       └── products.json
├── data/                       # LibSQL sqlite file at runtime (gitignored)
│   └── .gitkeep
├── package.json
└── tsconfig.json
```

**Testing:** three tiers — **unit** for the deterministic code seams (route/filter/sort/categories),
**integration** for the whole pipeline with externals mocked, and **evals** for the Epic 4 edge cases
(US-6.1). External calls (OpenAI, DummyJSON) are always mocked; no live keys in tests.

---

## `frontend/` — assistant-ui chat app

Renders what it's streamed; holds only the conversation id in the URL (`/c/{id}`, D5). Cards render via
an assistant-ui tool UI bound to the `product-results` parts (D6, D8).

```
frontend/
├── src/
│   ├── app/                    # routes
│   │   ├── page.tsx            # conversations list (home)               US-3.3
│   │   └── c/[id]/page.tsx     # a conversation; rehydrates by id        US-3.1, D5
│   ├── components/
│   │   ├── chat/
│   │   │   ├── Thread.tsx      # assistant-ui thread + streaming
│   │   │   └── Composer.tsx    # input
│   │   ├── products/
│   │   │   ├── ProductResultsUI.tsx  # makeAssistantToolUI("product-results")  D6/D8
│   │   │   ├── ProductCardGroup.tsx  # one group per intent
│   │   │   └── ProductCard.tsx       # title · description · price · image      US-2.1
│   │   ├── conversations/
│   │   │   ├── ConversationList.tsx  # list + search                    US-3.3/3.4
│   │   │   └── NewConversation.tsx   #                                  US-3.2
│   │   ├── profile/
│   │   │   └── RememberedPrefs.tsx    # read-only view + reset           US-7.4
│   │   └── states/
│   │       ├── Loading.tsx
│   │       └── NoResults.tsx         #                                  US-4.4
│   ├── runtime/
│   │   └── mastra-runtime.ts   # assistant-ui ↔ Mastra/AI-SDK runtime adapter  D8
│   ├── api-client/
│   │   └── conversations.ts    # fetch wrappers to the server API (§6)
│   └── lib/
│       └── format.ts           # price/availability formatting
├── tests/                      # Jest + React Testing Library — UI ONLY, all mocked
│   ├── components/
│   │   ├── ProductCard.test.tsx
│   │   ├── ProductCardGroup.test.tsx
│   │   ├── ConversationList.test.tsx
│   │   └── RememberedPrefs.test.tsx
│   ├── mocks/
│   │   ├── product-results.ts  # mock stream parts / products (from shared schemas)
│   │   ├── conversations.ts     # mock list + history
│   │   └── server.ts            # mock API client (no real backend)
│   └── setup.ts                # jsdom + testing-library setup
├── jest.config.ts
├── package.json
└── tsconfig.json
```

**Testing:** **Jest + React Testing Library, UI only.** Components are tested in isolation against
**mocked** data (mock `product-results` parts, mock conversation list, mock API client) — no real server,
no real model, no network. Verifies rendering and interaction: a card shows title/price/image, a group
renders per-intent, the list filters on search, the prefs view shows + resets.

---

## Testing at a glance

| Package | Tooling | Scope | Externals |
|---------|---------|-------|-----------|
| `shared/` | unit | schema parse / reject / defaults | none |
| `server/` | unit · integration · evals | code seams · full pipeline · Epic 4 edge cases (US-6.1) | OpenAI + DummyJSON **mocked** |
| `frontend/` | Jest + RTL | UI render + interaction | everything **mocked** (no backend) |

The shared schemas are the seam: the server validates outgoing parts against them, the frontend mocks and
renders against the same shapes, so the two can't drift.
