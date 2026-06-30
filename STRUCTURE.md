# Project Structure — Bazak AI Shopping Copilot

The repository is a workspace of three packages, each with its own test suite:

- **`shared/`** — types + Zod schemas that are the contract between the other two.
- **`server/`** — the Mastra orchestration pipeline, catalog client, persistence, and HTTP/streaming API.
- **`frontend/`** — our own Next.js chat app on `@mastra/client-js` (no chat framework).

This implies a **decoupled** topology: a standalone Mastra/Node **server** and a separate **frontend**
app (rather than a single Next.js full-stack host). See [README.md](README.md) (*Architecture & Framework
Choice*) for how the pieces fit and [DECISIONS.md](DECISIONS.md) for why (`Dn`); story tags below are
`US-x` from [USER_STORIES.md](USER_STORIES.md).

```
bazak-ai-shopping-copilot/
├── shared/        # contract: types + Zod schemas (consumed by server + frontend)
├── server/        # Mastra pipeline · catalog client · Mastra Memory · API
├── frontend/      # own Next.js chat app on @mastra/client-js
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
│   │   └── api.ts              # request/response contracts for every endpoint (README → HTTP / streaming API)
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

## `frontend/` — own Next.js chat app

Our own chat UI (Next.js App Router, client-side only, Tailwind), built from `UX/mocks/*.html`. Renders
what it's streamed; holds only the conversation id in the URL (`/c/{id}`, D5). The data layer is
`@mastra/client-js` straight to the Mastra endpoints (D8, D11); a small `runTurn` stream parser turns the
workflow stream into `{ groups, text }`, and our `<ProductResults>` renders the `data-product-results`
parts as card groups (D6) — no chat framework, no runtime adapter.

```
frontend/
├── src/
│   ├── app/                    # routes (App Router, client components)
│   │   ├── layout.tsx          # root layout (Tailwind, fonts)
│   │   ├── page.tsx            # conversations list (home)               US-3.3
│   │   └── c/[id]/page.tsx     # a conversation; rehydrates by id        US-3.1, D5
│   ├── components/
│   │   ├── chat/
│   │   │   ├── UserMessage.tsx        # right-aligned user bubble         US-1.1
│   │   │   ├── BotMessage.tsx         # summary / decline / chitchat / error+Retry   US-4.x/5.2
│   │   │   ├── Loading.tsx            # typing dots + status + skeletons
│   │   │   └── Composer.tsx           # input + send
│   │   ├── products/
│   │   │   ├── ProductResults.tsx     # all groups + "Showing X of Y / Show more"; branches on display  D6/D16
│   │   │   ├── ProductCardGroup.tsx   # one labelled group per intent     US-1.3
│   │   │   ├── ProductCard.tsx        # title · desc · price · image · stock · deal  US-2.1/1.7
│   │   │   ├── RecommendationCard.tsx # single spotlighted pick + badge   US-2.2/2.3/D16
│   │   │   ├── ProductComparison.tsx  # two products side-by-side spec table  US-2.4/D16
│   │   │   └── NoResults.tsx          # names the relaxed constraint      US-4.4
│   │   ├── conversations/
│   │   │   ├── Sidebar.tsx            # logo + new + list + search        US-3.2/3.3/3.4
│   │   │   └── ConversationRow.tsx    # title · preview · relative time
│   │   └── profile/
│   │       └── RememberedPrefs.tsx    # read-only view + reset            US-7.4
│   ├── hooks/
│   │   └── useConversation.ts  # load history · optimistic send · progressive stream · retry
│   ├── api-client/
│   │   ├── conversations.ts    # list/create/get/delete/messages → shared shapes (§6)
│   │   └── turn.ts             # runTurn(): async-iterate the workflow stream → { groups, text }
│   └── lib/
│       ├── mastra-client.ts    # configured MastraClient (base URL, resourceId)   D8/D11
│       └── format.ts           # price · derived sale price · relative time · stock label
├── tests/                      # Jest + React Testing Library — all mocked, no backend
│   ├── unit/                   # the pure FE logic (highest-value)
│   │   ├── turn.test.ts        #   canned stream chunks → asserted groups + text
│   │   ├── messages.test.ts    #   Mastra message → ChatMessage (+ results rehydrate)
│   │   └── format.test.ts      #   price / sale price / relative time / stock label
│   ├── components/
│   │   ├── ProductCard.test.tsx
│   │   ├── ProductResults.test.tsx
│   │   ├── RecommendationCard.test.tsx
│   │   ├── ProductComparison.test.tsx
│   │   ├── Sidebar.test.tsx
│   │   └── RememberedPrefs.test.tsx
│   ├── mocks/
│   │   ├── product-results.ts  # mock stream parts / products (from shared schemas)
│   │   └── client.ts           # mock MastraClient (no real backend)
│   └── setup.ts                # jsdom + testing-library setup
├── jest.config.ts
├── next.config.ts
├── tailwind.config.ts
├── package.json
└── tsconfig.json
```

**Testing:** **Jest + React Testing Library.** Two halves: **unit tests for the pure logic** — the
`runTurn` stream parser (canned chunks → per-intent groups + final text), the Mastra-message→`ChatMessage`
mapper, and the `format` helpers — and **component tests** against **mocked** data (mock `product-results`
parts, mock `MastraClient`). No real server, model, or network. Verifies a card shows title/price/image
and derived sale price, a group renders per-intent, the list filters on search, the prefs view shows +
resets.

---

## Testing at a glance

| Package | Tooling | Scope | Externals |
|---------|---------|-------|-----------|
| `shared/` | unit | schema parse / reject / defaults | none |
| `server/` | unit · integration · evals | code seams · full pipeline · Epic 4 edge cases (US-6.1) | OpenAI + DummyJSON **mocked** |
| `frontend/` | Jest + RTL | stream-parser / mapper / format units · UI render + interaction | everything **mocked** (no backend) |

The shared schemas are the seam: the server validates outgoing parts against them, the frontend mocks and
renders against the same shapes, so the two can't drift.
