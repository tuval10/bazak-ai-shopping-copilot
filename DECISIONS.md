# Architecture Decisions — Bazak AI Shopping Copilot

A running log of architectural decisions, why they were made, and the alternatives rejected.
Lightweight ADR style. See [USER_STORIES.md](USER_STORIES.md) for scope and [FUTURE.md](FUTURE.md)
for deferred work. Entries are **Accepted**; revised or newly added entries note their date.

---

## D1 — Thin local backend (not client-only)

**Decision:** The browser is a thin client; orchestration, retrieval, and the OpenAI key live on a
local server. The client POSTs a turn and renders the response.

**Why:** Keeps the API key out of the browser, lets the pipeline be unit-tested/evaluated in
isolation (US-6.1), and gives a clean seam between UI and logic.

**Alternatives rejected:**
- *Client-only* (browser calls OpenAI + DummyJSON directly) — simplest to run, but exposes the API
  key and is hard to test/eval.

---

## D2 — Explicit pipeline orchestration (not a single agent + tools)

> **Note (2026-06-29):** the *principle* below — a deterministic, testable spine with
> non-determinism boxed into discrete LLM steps — **still stands**, but the concrete shape is
> **superseded by D13**: the pipeline is now `orchestrate → discover → generate` (an orchestrator
> + sub-agents), and the model tier moved to `gpt-5.4-mini` for the planning/judgment steps.

**Decision:** Layer 4 is a deterministic pipeline:
`classify + extract → route → plan + retrieve → generate`. The LLM is used for two discrete
sub-tasks (classify, generate); everything between is plain, testable code.

**Why:** Each arrow is a testable seam, cost/latency are predictable (two LLM calls per turn),
non-determinism is boxed into two well-defined spots, and it's straightforward to defend
("I control every step"). Matches the assignment's "a simpler solution you fully understand."

**Alternatives rejected:**
- *Single agent loop with tools* (model decides which tools to call) — more flexible and less code
  for open-ended flows, but non-deterministic, harder to eval, and pricier per turn.

**Model selection:** `gpt-5.4-nano` for classify/extract, `gpt-5.4-mini` for response generation.

---

## D3 — Server owns conversation persistence

> **Note (2026-06-28):** the *principle* below stands, but the concrete **endpoint table is superseded
> by D9** — the client now uses Mastra's built-in endpoints, not a custom `/api/conversations…` REST API.

**Decision:** The server owns all conversation state. The client holds only the current
`conversationId` and sends `{ conversationId, message }` per turn. On refresh, the client re-fetches
the conversation from the server by id.

**Endpoints:**
| Endpoint | Story |
|---|---|
| `POST /conversations` → new id | US-3.2 |
| `GET /conversations` (+ `?q=` search) | US-3.3, US-3.4 |
| `GET /conversations/{id}` → full history | US-3.1, US-3.3 |
| `POST /conversations/{id}/messages` → run pipeline, persist, reply | US-1.x, US-4.x |

**Why:** Persistence requirement (US-3.1) is satisfied server-side; the client stays genuinely thin;
no server-side *session* coupling beyond loading a conversation by id. The store itself is **Mastra
Memory** (D4) — these endpoints are thin wrappers over its API.

**Alternatives rejected:**
- *Client-owned persistence* (localStorage/IndexedDB, stateless server) — viable, but the user chose
  a server-owned store so transcripts aren't tied to one browser and failure modes are centralized.

---

## D4 — Conversation storage: Mastra Memory (LibSQL)  ·  *revised 2026-06-28*

**Decision:** Use **Mastra Memory** as the single conversation store — **threads** hold the message
transcript and **working memory** holds per-user preferences — backed by **LibSQL** (Mastra's
default; a local SQLite engine). The persistence endpoints (D3) are thin wrappers over the Mastra
Memory API.

> **Supersedes** the original D4 (append-only JSONL, one file per conversation). This reverses that
> decision deliberately — see *Why changed* below.

> **Note (2026-06-29):** working memory holds **durable preferences only** (name, lasting budget,
> favoured/disliked categories/brands) — never the current query or a running conversation summary.
> The scope is **resource** (persists across all of a user's threads), so storing transient query
> phrases leaks them into later, unrelated conversations and corrupts planning (D13). The generator
> instructions + the `notes` field description enforce this; `DELETE /profile` (D9a) clears it for a
> fresh slate before testing.

**Why:**
- We committed to **Mastra** for orchestration (D7). Letting it also own persistence removes an entire
  hand-rolled layer (transcript write/replay + conversation list/search) — native **threads** give
  list/resume/search out of the box (US-3.x).
- **Working memory** delivers the personalization loop (Epic 7) at near-config cost — learn, persist
  per-user, personalize replies — which is what motivated the change.
- **Semantic recall** (vector search over past messages, LibSQL + FastEmbed) is then available for the
  agentic future we're future-proofing for (D7); messages are already in the store.
- Single store, less code, fewer moving parts to defend.

**Why changed (honesty note):** the original JSONL decision leaned on **concurrency** and
**portability** advantages we later conceded are weak for a *single-user, local* app. Its remaining
pros (crash-safe appends, greppable transparency) are nice-to-haves now covered by **Mastra Studio +
OpenTelemetry tracing**. Once personalization came "for free" with working memory and we were already
on Mastra + LibSQL, a separate JSONL transcript stopped earning its keep.

**Failure handling (US-5.2):** LibSQL is a durable embedded SQLite engine (WAL, atomic commits);
handle write/disk errors gracefully and never surface a raw DB error to the user.

**Alternatives rejected:**
- *Append-only JSONL, one file per conversation* — the prior choice; clean for an immutable transcript
  and transparent to inspect, but a second bespoke store that duplicates what Mastra threads give for
  free and can't back semantic recall. Reasonable, but redundant once we're on Mastra.
- *Postgres / other Mastra storage adapters* — fine, but heavier to run locally than LibSQL's single
  file; revisit if we outgrow local single-user.

---

## D5 — Client conversation pointer: URL route `/c/{id}`

**Decision:** The active conversation id lives in the URL (`/c/{id}`) — the id is the **Mastra thread
id** (D4). Refresh reloads the route and re-fetches from the server (US-3.1).

**Why:** No extra browser state to manage; bonus back/forward navigation and shareable/bookmarkable
conversations.

**Alternatives rejected:**
- *localStorage pointer* — works, but no shareable URLs and one more piece of browser state.

---

## D6 — Structured product results as streamed, typed parts  ·  *amended 2026-06-28*

**Decision:** The server still produces per-intent product results — one entry per intent, each with its
own `products` array (multi-intent → multiple entries; single intent → one). **Amendment:** rather than
returning them as one custom JSON response body, the generate step **streams them as typed parts on the
workflow stream** alongside the assistant text — one `product-results` part per intent (emitted via
`writer.custom({ type: "data-product-results", data })`). Our own `ProductResults` component (D8) renders
each part as a product-card group (US-2.1).

Content per part is unchanged; only the envelope is now an AI-SDK-native part rather than a field in one
JSON blob:

```jsonc
// each streamed as its own typed "product-results" part, not a single response body:
{ "intent": "phone under $500", "products": [ {…}, {…} ] }
{ "intent": "laptop bag",       "products": [ {…} ] }
```

> **Supersedes** the original D6 (a single JSON body: `{ message, results: [...] }` rendered by a custom
> client renderer). Same content, AI-SDK-native envelope.

**Why amended:** streaming results as typed parts (instead of one end-of-turn JSON body) lets cards render
**as each intent resolves** and keeps the assistant text and the card groups in one ordered turn. Because
the **D2 pipeline (not the model) produces the results**, the generate step **writes these as custom data
parts** onto the workflow stream — the model never "decides" to call a tool. The frontend (D8) reads the
`data-product-results` parts off the stream and renders each as a card group.

**Why (unchanged):** server shapes data, client owns presentation (US-2.1); multi-intent (US-1.3) falls
out naturally as multiple parts. Grounding (US-5.1) stays server-enforced — only products actually
returned by the catalog are ever emitted.

**Alternatives rejected:**
- *Single custom JSON response body* (the original D6 shape) — simplest, but can't stream cards per intent
  as each resolves; the part-based envelope gives progressive rendering for little extra cost.

---

## D7 — Orchestration framework: Mastra  ·  *added 2026-06-28*

**Decision:** Build the orchestration layer (the D2 pipeline) on **Mastra** — a TS-native agent +
workflow framework built on top of the Vercel AI SDK. The deterministic pipeline runs as Mastra
workflow steps; agents back only the two LLM steps (classify, generate). SSE to the client uses
`@mastra/ai-sdk` → AI SDK v5 streams, consumed by assistant-ui (D8). Conversation + preference storage
use Mastra Memory (D4).

**Why:**
- **Studio traceability / debugging** — Mastra Studio gives visual, step-level traces of each run,
  making the pipeline observable and easy to debug.
- **Future-proofing** — the flow is deterministic today, but we expect to add agents for new purposes;
  Mastra's workflow + agent + memory primitives absorb that growth without a rewrite.
- Matches the team's stack; first-class evals serve the testing requirement (US-6.1); reuses AI SDK at
  the UI edge so we still get best-in-class SSE streaming.

**Alternatives rejected:**
- *Vercel AI SDK direct* — lightest and simplest to fully explain; our deterministic flow wouldn't
  strictly need a workflow engine. Rejected for the two reasons above (no Studio / no first-class
  evals, no team-stack match) — the honest fallback if the flow stays non-agentic. Note Mastra is
  built *on* AI SDK, so we keep its streaming either way.
- *LangChain / LangGraph (JS)* — powerful graph + durable checkpoints, but Python-first with grafted
  TS that trails releases, heavier, weaker serverless story.
- *LibreChat* — a finished self-hosted chat product; wrong shape for a bespoke discovery pipeline with
  custom cards and our own persistence.
- *Fully custom* — maximum control, but reinvents orchestration/streaming we'd rather not own.

**Model selection (unchanged):** `gpt-5.4-nano` for classify/extract, `gpt-5.4-mini` for generation.

---

## D8 — Front-end chat layer: own UI on `@mastra/client-js`  ·  *reversed 2026-06-28*

**Decision:** Build our **own** small, accessible chat UI (Next.js App Router, hand-built components from
`UX/mocks/*.html`, Tailwind) talking to the existing Mastra endpoints through the official browser client
**`@mastra/client-js`**. No chat framework. Product cards are rendered by our own `ProductResults`
component from the streamed `product-results` parts (D6); the rest of the shell (message list, composer,
autoscroll, loading/error states, a11y) is bespoke.

> **Reverses** the original D8 (assistant-ui). The reversal is deliberate — see *Why changed*.

**Why changed (honesty note):** the original D8 assumed assistant-ui would drop in via a "first-class
Mastra adapter." Researching the *current* assistant-ui ⇄ Mastra story showed our backend is off
assistant-ui's documented path:
- Every official assistant-ui ⇄ Mastra integration assumes a Mastra **agent** stream (`@mastra/ai-sdk`
  `chatRoute`), **not a workflow stream** — and our front door is the D2 **workflow** (`/api/workflows/
  pipeline/stream`). Bridging would mean adding an agent-shaped conversion route purely to satisfy the UI.
- `makeAssistantToolUI` — the exact API D6/D8 leaned on to render cards — is **deprecated** (superseded by
  a toolkit API + a backend-pushed data-UI path), so the "single registration" advantage evaporated.
- Our cards are a **server-produced data part**, not a model tool-call; forcing them through a tool-UI is
  conceptually wrong and would need undocumented glue.

Net: adopting assistant-ui meant using a framework off-label, adding a conversion route, and wiring an
undocumented data path — *more* plumbing than it removes. A small owned UI on the official client is
simpler, fully understood, and matches the assignment's "a simpler solution you can defend." The generic
chat shell we'd have delegated is modest; the bespoke/interesting part (the product-card groups) is
hand-built either way.

**Why (unchanged):** keeps the thin client (D1) and the decoupled topology — a backendless Next.js app
talking straight to Mastra's endpoints; presentation stays fully ours (US-2.1).

**Alternatives rejected:**
- *assistant-ui* (the original choice) — prebuilt shell + autoscroll/streaming for free, but assumes an
  agent stream, its card-rendering API is deprecated, and our results are data not tool-calls; the
  integration cost exceeded the shell it would have saved.
- *CopilotKit* — built to bolt a copilot **onto an existing app**; wrong shape for a chat-first app.

---

## D9 — API exposure: Mastra's built-in endpoints (not a custom REST API)  ·  *added 2026-06-28*

**Decision:** The client talks to **Mastra's built-in HTTP endpoints** rather than a hand-rolled REST
API. A turn runs through the workflow stream endpoint; conversation list/resume/history come from the
memory thread endpoints. Exactly **one** custom route is added (D9a) for the working-memory gap.

| Need | Endpoint | Story |
|------|----------|-------|
| Run a turn (pipeline) → stream text + `product-results` parts | `POST /api/workflows/{id}/stream` (`inputData: { message, threadId, resourceId }`) | US-1.x, US-4.x, US-7.x |
| New conversation | `POST /api/memory/threads` | US-3.2 |
| List / resume conversations | `GET /api/memory/threads` · `GET /api/memory/threads/{id}` | US-3.3 |
| Conversation history (refresh) | `GET /api/memory/threads/{id}/messages` | US-3.1 |
| Delete a conversation | `DELETE /api/memory/threads/{id}` | — |

**D9a — one custom route (`registerApiRoute`):** `GET`/`DELETE /profile` reads and resets per-user
working memory (US-7.4) — there is no built-in working-memory HTTP route. The path is `/profile`, **not**
`/api/profile`: Mastra reserves the `/api` prefix for its built-in routes and rejects custom routes under
it. **Conversation search (US-3.4) is client-side** (filter the thread list by title) — there is no
built-in thread text-search endpoint.

**Running the server:** `npm run dev` (`mastra dev`, with Studio) for development, or `npm start`
(`mastra build` → `node .mastra/output/index.mjs`) for a production-style run. Both work and serve every
endpoint.

> **Gotcha (resolved):** a single workspace package must not end up with its own `node_modules/zod` at a
> different major than the hoisted root — `require.resolve("zod")` prefers the package-local copy, so
> Mastra would load that zod's `toJSONSchema` and crash Studio at boot with "non-representable optional".
> Keep zod deduped to one version across the workspace (a clean `npm install` does this). The DB path is
> resolved to an absolute path at the package root (env.ts) because `mastra build` runs from
> `.mastra/output`, where a relative `./data` wouldn't exist.

**Why:** we already committed to Mastra (D7) for orchestration *and* persistence (D4); its generated
endpoints cover the turn + the entire thread lifecycle, so a parallel hand-rolled REST layer would be
duplicate code wrapping the same calls. Less surface to build, test, and keep in sync.

**Supersedes** the custom `POST/GET /api/conversations…` endpoint table in **D3** and **ARCHITECTURE §6**.
D3's underlying principle — *the server owns persistence; the client holds only the conversation id* —
**still stands**; only the concrete endpoints change (they're now Mastra's, not ours).

**Alternatives rejected:**
- *Custom REST API over Mastra Memory* (the original D3 table) — clean, fully our-designed contract, but
  redundant: every handler would just forward to a Mastra call. Kept only the one route Mastra doesn't provide.

---

## D10 — Backend test runner: Vitest  ·  *added 2026-06-28*

**Decision:** `shared/` and `server/` use **Vitest**. The frontend keeps **Jest** (its own package,
STRUCTURE.md).

**Why:** native ESM/TS with no extra transform config, fast, and aligned with Mastra/AI-SDK's ESM stack
and AI SDK's `MockLanguageModelV2` test double (used to mock the model in pipeline tests). Jest on the BE
would need ts-jest/babel glue and fights the ESM modules.

**Alternatives rejected:**
- *Jest everywhere* (FE consistency) — extra ESM/TS config and friction with Mastra's modules; the
  packages are independent, so a per-package runner choice costs nothing.

---

## D11 — Frontend shape: own Next.js App-Router app, client-side only  ·  *added 2026-06-28*

**Decision:** The frontend is a **Next.js App Router** app rendered client-side with **no FE backend** —
every data call goes from the browser straight to the Mastra server via `@mastra/client-js` (D8). Routes:
`/` = conversations list, `/c/{id}` = a conversation (`{id}` is the Mastra thread id, D5). Styling is
**Tailwind** with the mocks' `bazak` palette (`#6366f1 / #4f46e5 / #eef2ff`); components are hand-built
from `UX/mocks/*.html`. All server responses are validated against `@bazak/shared` Zod schemas — the same
contract the server emits — so drift between the two surfaces is caught at the seam. Tests: **Jest + RTL**
for components plus Jest unit tests for the pure stream-parser / mappers / format helpers (D10).

**Why:** matches D1 (thin client) and D8 (own UI on the official client). No Next.js API routes / server
components doing data work means one less place state can live — the server owns persistence (D3), the
browser holds only the conversation id in the URL (D5). The shared-schema seam keeps FE and BE honest
without a generated client.

**Alternatives rejected:**
- *Next.js with server-side data fetching (RSC / route handlers)* — would re-introduce a FE backend that
  just proxies Mastra, duplicating D9's endpoints. Client-only keeps the topology flat.
- *Vite SPA* — fine and lighter, but Next's App Router gives routing/layouts out of the box and is the
  team-standard React stack.

---

## D12 — Per-turn results persisted for resume fidelity  ·  *added 2026-06-28*

**Decision:** Persist each assistant turn's **product results** (the per-intent groups) alongside the
assistant message in the thread, as message **metadata**, so loading history (`GET /api/memory/threads/
{id}/messages`) rehydrates the **cards**, not just the prose. On a turn, results stream live as
`data-product-results` parts (D6); on refresh/resume they come back from the persisted metadata.

**Why:** US-3.1 (resume on refresh) requires the conversation to come back *as it was*. The streamed parts
are ephemeral — without persisting them, a resumed conversation would replay the assistant text with the
product cards missing, which reads as broken. Storing the already-computed, already-grounded results (no
re-retrieval, no second model call) is the cheap, faithful fix.

**Why metadata (not a re-query):** the results are deterministic given the turn, but re-running retrieval
on history load would be slower, could drift if the catalog changed, and wastes calls. Persisting the
exact groups that were shown is both faithful and free at read time.

**Alternatives rejected:**
- *Re-retrieve on history load* — avoids storing anything, but is slower, can drift, and re-does work.
- *Don't persist (prose only)* — simplest, but loses cards on resume and undercuts US-3.1.

---

## D13 — Agentic orchestrator + sub-agents (hybrid workflow shell)  ·  *added 2026-06-29*

> **Amends D2.** D2's *principle* — a deterministic, testable spine with non-determinism boxed into
> discrete LLM steps — **still stands**. What changes: the LLM seams and the retrieval step become an
> **orchestrator + sub-agents**, and the **finder becomes a model-driven, tool-using agent** that owns
> retrieval + relaxation by calling catalog search tools. The spine is still a **Mastra workflow** (D7):
> the agent-with-tools loop is *scoped inside the single `discover` step* (bounded by `FINDER_MAX_STEPS`),
> not a top-level supervisor that owns the whole turn.

**Decision:** Replace `classify → route → retrieve → generate` with `orchestrate → discover →
generate`, where each step is a deterministic workflow step that calls one specialized agent for its
single judgment:
- **orchestrator** — decomposes the turn (multi-intent → several "finders"), classifies
  `product`/`chitchat`/`off_catalog`, marks hard-vs-soft constraints, and flags continuations (D14). It
  is **category-aware**: the live catalog category list (cached, see below) is injected into its prompt,
  so it routes against *real* categories and, for an off-catalog ask, still **merchandises** — spawning
  finders that each target a real category slug (e.g. "flight to Tokyo" → `mobile-accessories`,
  `sunglasses`, `womens-bags`). One planning call per turn.
- **discovery** (the *finder* sub-agent) — runs once per finder; drives two catalog tools —
  `product_search` (keyword) and `category_browse` (by slug) — to retrieve and, when too few match, relax
  (broaden the keyword / browse a whole category / drop a *soft* constraint), then returns its chosen
  products **by id** as ordered, framed groups. Code resolves ids → real products, enforces hard
  constraints, dedups, and computes the deterministic `relaxed` fact (constraint + real catalog value).
- **concierge** — chit-chat + the honest off-catalog decline (only when discovery returns nothing).
- **generator** — unchanged role: grounded prose; holds conversation memory (D4).

"Sub-agents" are specialized `agent.generate()` calls invoked *from steps* (all registered as real
Mastra agents → visible in Studio), **not** tool-call delegation.

**Two-tier budget (deterministic caps):** `MAX_PRODUCT_FINDERS` (.env, default 5) caps finders/turn
(`slice` in orchestrate — the model may propose more, only N run); `FINDER_MAX_STEPS` (.env, default 4)
caps the tool-calling turns per finder (Mastra `maxSteps` on the finder's `.generate()` — each step is
one LLM call + tool cycle). Worst case 5 × 4 = **20 finder tool-loops/turn**. The finder cap is the model
ceiling (`slice`, hard); the per-finder step cap is `maxSteps` (soft — the model usually stops earlier).

**Concurrent fan-out:** finders run in `Promise.all` inside the single `discover` step — *not*
workflow-level `.parallel()`/`.foreach()`. Finder count is dynamic (1–5); `.parallel` needs a static
step array, and `.foreach` isolates iterations and fights the per-turn shared state (categories fetched
once, cross-finder dedup, the turn ceiling). One step scope handles dynamic N, shares that state, and
holds the single stream writer so each group streams as its finder resolves. Finder-level tracing via
`createChildSpan` keeps the top-level trace linear.

**Categories as shared context (not a tool):** the 24 real catalog categories are fetched once and cached
in-memory for 24h by a `CategoriesProvider` singleton (concurrent-`get()` dedup onto one in-flight
promise; returns `[]` *uncached* on failure so the next turn retries and every consumer degrades to
current behavior). The list is injected as **prompt text** into both the orchestrator and the finder, so
the model routes/keywords against real slugs. It is **never** exposed as a raw endpoint-list tool — the
finder *retrieves* through the two scoped search tools (`product_search`, `category_browse`), and the
category list is context it picks slugs from.

**Per-category counts (one call, not 24):** each category line carries its size — `slug — name (N items)`
— so the orchestrator can judge how thin a category is and broaden a finder when the best-fit category
holds only a couple of items (its motivating case: "flight to Tokyo" → if a bag category is tiny, ask the
finder for any bag and let it decide fit). The counts come from a **single** `/products?limit=0&select=category`
request (the whole 194-product catalog, category field only — ~7 KB) tallied client-side, **not** 24
per-category calls; it runs concurrently with the category-list fetch behind the same 24h cache (two cached
calls/day total). Counts are a **nice-to-have**: if that one call fails, the list still serves *without*
counts (the `(N items)` suffix is simply dropped) rather than failing the turn. Counts inform *planning
breadth* only — they don't change grounding or the finder's own match-count-driven relaxation.

**Grounding by construction (extends US-5.1):** the model never *authors* product data. The finder sees
only a **lean read-only view** (id/title/price/rating/stock/…) returned by the search tools and selects
products **by id**; code resolves those ids → real `Product` objects captured from the tool calls,
dropping any unknown/hallucinated id. Prices, images, and the `relaxed` from/to values flow catalog →
typed stream parts → never authored by an LLM. The model authors only *framing* — prose, each group's
`rationale`, and suggestion-chip phrasing (chip *options* are data-derived and Zod-validated).
Hard-constraint enforcement (re-applied **inside** the search tools *and* again in assembly), the
finder/turn caps, dedup, and the relaxed facts are code.

**Model selection (updates D2/D7):** the orchestrator, discovery, and concierge run on
**`gpt-5.4-mini`**, not nano. The per-turn judgments are now genuinely harder than "classify/extract" —
hard-vs-soft constraints, what *not* to invent, which axis to relax without drifting off-topic — and
nano was unreliable (over-marking plain "under $100" as hard; over-broadening relaxation into junk). We
pay for stronger judgment rather than patch model output with regex. Discovery is mini because it now
drives multi-step tool use (search → read match counts → relax or browse) once per finder — judgment
nano was inconsistent at, drifting off-topic when relaxing.

**Observability:** structured logging via **`@mastra/loggers` PinoLogger** registered on the Mastra
instance (replaced an ad-hoc `console.log` trace), level-gated by `LOG_LEVEL`, unified with Mastra's own
step/agent traces.

**Why (over the prior deterministic flow):** the old flow returned one focused result set — it couldn't
*merchandise*: relax a too-tight budget across several framed angles, or present adjacent items for an
off-catalog ask (US-4.1/4.2/4.4). The orchestrator also decides finder count dynamically (multi-intent,
off-catalog adjacency) instead of a fixed extract.

**Why scoped-agentic over a full supervisor (one model loop owning the turn):** the agentic loop is
*scoped* — the finder calls tools to retrieve/relax, but inside a single workflow step, bounded by
`FINDER_MAX_STEPS`, with its output **grounded by code** (ids → real products) and hard constraints
re-enforced outside the model. The orchestrator (planning) and generator (prose) stay separate
deterministic seams rather than one model-driven supervisor owning the whole turn. This keeps grounding
by construction and reuse of the injectable seams (`CatalogDeps`, `PartWriter`) the eval suite fakes,
while gaining **traced, model-driven retrieval** (each search/browse is a tool span). Cost: per-finder
tool cost and a *soft* per-finder step cap (`maxSteps`) rather than a hard call counter — an accepted
trade for traceability + adaptive relaxation.

**Alternatives rejected:**
- *Full supervisor owning the whole turn (one model loop calling retrieve/relax/respond)* — we adopted
  agentic retrieval but kept it **scoped to the finder** with id-based grounding and a bounded tool-loop;
  a single end-to-end supervisor would still break grounding (the model handling product data), lose the
  separate provable finder cap, and be harder to eval.
- *Deterministic budgeted relaxation loop (the original D13: a relaxation-planner agent + code-executed
  axes, capped by a `DISCOVERY_MAX_CALLS` counter)* — replaced. It made catalog calls invisible in traces
  and split retrieval logic between a planner agent and executor code; the tool-using finder is traceable
  (a span per search) and keeps the relax decision with the agent that sees the results.
- *Regex gate for hard-vs-soft / invented constraints* — tried and removed; the LLM should judge. (For
  continuations, D14 sidesteps invention deterministically instead.)
- *Workflow `.parallel()` / `.foreach()` for fan-out* — a static array / isolated iterations don't fit a
  dynamic finder count over shared per-turn state.

---

## D14 — "Show me more" via deterministic continuation  ·  *added 2026-06-29*

**Decision:** A pure "show me more / next / others" turn is handled as a **continuation**, not a
re-plan. The orchestrator flags `continuation: true` and emits no finders; the discover step then
**reuses the prior turn's finder** and **excludes every already-shown product id**, paging forward. Both
the prior finder and the shown ids are read from the **persisted assistant-message metadata** (D12) —
the turn's finders are persisted alongside its results under a `finders` metadata key. Dedup + paging
are plain code; the model does no id bookkeeping.

**Why:** "show me more" must return the *next* products with no repeats. Letting the orchestrator
re-plan a vague follow-up was wrong twice over: it **invented constraints** (a fabricated `$150–$500`
band) and **repeated products** (no notion of what was already shown). Both are deterministic concerns:
- *No repeats* — exclude shown ids (read from D12 metadata) before paginating.
- *No re-invention* — a continuation reuses the exact prior finder, so there is nothing to re-extract or
  fabricate; the original constraints carry forward unchanged.

**Why not push "what was shown" into the orchestrator:** it never sees product ids (grounding — D13),
and LLMs are unreliable at exact id bookkeeping across turns. Shown-id tracking is deterministic state,
so it lives in code, seeded from the store we already write each turn.

**Failure handling:** best-effort — if the flag is missed or no prior context is found, it falls back to
a normal plan (degrades, never crashes).

**Alternatives rejected:**
- *Let the orchestrator re-plan "show me more"* — the observed behavior: invented filters + repeated
  products.
- *A deterministic citation check on every constraint* (model cites the user-text span; code drops
  constraints not substring-present) — considered for the broader invented-constraints problem, but not
  adopted; the continuation path removes the need for the common (follow-up) case without extra machinery.
- *Server-side `skip`/offset paging* — viable (DummyJSON supports `skip`), but exclude-by-id over the
  already-fetched window is simpler, robust to re-sorting, and reuses persisted state.

---

## D15 — Supervisor orchestrator with a `find_products` tool  ·  *added 2026-06-29*

> **Amends D13/D14.** D13's hybrid 3-step spine (`orchestrate → discover → generate`) is **replaced**
> by a single **supervisor agent loop**. D13's *grounding-by-construction* principle and D14's
> continuation guarantee **still stand** — they are preserved by code around the loop, not by the loop.

**Decision:** Collapse the turn into one workflow step (`converseStep`) that runs a **supervisor agent**
with a single tool, `find_products`. The supervisor *drives* the turn:
- It decides **whether** to retrieve at all. For a follow-up about products already shown ("which do you
  recommend?", "what's the difference?") it **answers directly** from conversation memory + a
  PREVIOUSLY-SHOWN-PRODUCTS block — **no finder runs**. The old linear flow always ran discovery.
- For a shopping request it calls `find_products` **once per angle** (multi-intent → several; an
  off-catalog ask → a few adjacent briefs it then declines honestly while merchandising). Each call
  carries a rich natural-language **brief** (the situational "why"), not just keywords.
- Each call **returns its grounded results to the supervisor** (a lean narrative), which it reads to
  decide next steps and to write the reply — weaving **per-item reasoning into the prose** (kept in the
  message text; no per-card schema change).

**Why (over D13's linear hybrid):** the orchestrator never saw results, so it couldn't *decide-and-
synthesize* (skip discovery, react to what was found, weave per-item reasoning) — and it always
retrieved even when the answer was already on screen. A supervisor that owns the turn handles all three.

**How the invariants survive going fully agentic** (the crux — the loop is agentic, the guarantees are
code):
- **Grounding stays structural.** `find_products` runs the *same* finder sub-agent as before (selects
  products **by id** → code resolves real `Product`s) and **streams the cards itself** via the workflow
  `writer` (`data-product-results` parts). The model gets only a lean view to reason over; it never
  authors a card. The output contract (`{ message, results, chips }` + the stream parts + D12
  rehydration) is **unchanged** — the frontend and shared schemas are untouched.
- **Provable finder AND step caps despite an agentic loop.** Two run-local counters in `find_products`
  hard-stop the turn in code: one returns `limitReached` once `MAX_PRODUCT_FINDERS` finders have actually
  run (the catalog-cost ceiling), and one counts **every** call (including refused ones) and refuses past
  `SUPERVISOR_MAX_STEPS` tool-turns. So the supervisor cannot loop unbounded even if the framework's soft
  `maxSteps` is ignored — the soft `maxSteps` on `.generate()` stays as a belt-and-suspenders bound.
  `FINDER_MAX_STEPS` still bounds each inner finder.
- **Deterministic `relaxed` + dedup + continuation.** The finder's `relaxedFactFor`/hard-constraint
  enforcement/`assembleGroups` are reused unchanged. Already-shown ids are loaded once per turn and
  excluded from every call, so "show me more" pages forward with no repeats — D14's guarantee, now
  enforced inside the loop rather than by a dedicated continuation step.

**Roster change:** `orchestrator` + `generator` + `concierge` are retired and folded into one
**`supervisor`** agent (it holds Memory → persists the transcript US-3.1 + learns durable preferences
US-7.1, and writes all prose: merchandise, decline, chit-chat). `discovery` remains as the finder
sub-agent the tool drives. Model: `gpt-5.4-mini` (judgment-heavy; nano was unreliable, per D13).

**Accepted costs:**
- The supervisor's **prose** is grounded by the lean summary the tool returns (it could mis-state a
  price in prose) — the **cards remain authoritative** (code-emitted, by id). Same guarantee level as
  D13's generator prose.
- Multi-round tool use means a turn can be a few sequential finder calls before the reply (higher
  latency/cost than the old single fan-out) — bounded by the two caps and accepted for the
  decide-and-synthesize behavior.

**Alternatives rejected:**
- *Structured gate (plan → maybe-discover → synthesize as separate steps)* — keeps a deterministic spine
  and would have been more incremental, but the user explicitly chose the supervisor loop for its
  literal decide-then-act control flow and multi-round capability.
- *Per-item reasoning as a card field* (extend `ProductResultsPart` + frontend) — deferred; per-item
  reasoning lives in the woven prose, so no schema/FE change was needed.

---

## D16 — Recommendation / value / comparison as `display` variants of `ProductResultsPart`, picked by two new supervisor tools  ·  *added 2026-06-29*

> **Builds on D6/D12/D15.** Adds three buyer-facing presentation outcomes without adding a new stream
> part type — they ride the existing `data-product-results` part, so the whole streaming + persistence +
> rehydration path carries them unchanged.

**Decision:** Give the supervisor two more grounded tools alongside `find_products`:
- **`recommend_product`** — spotlights **one** already-shown product with a badge (`recommended` or
  `best-value`) + a reason. Renders as a hero card (US-2.2/2.3).
- **`compare_products`** — lays **two** already-shown products side by side as a spec table, with an
  optional `winnerId` (US-2.4).

Both **reuse the existing part type**: the schema gains an optional `display`
(`grid` | `recommendation` | `comparison`) discriminator plus `badge`/`winnerId`, and the model's reason
reuses the existing `rationale` field. The frontend branches on `display` (`ProductResults` →
`RecommendationCard` / `ProductComparison` / the default `ProductCardGroup`).

**Why this shape (not new part types):** `workflowOutputSchema`, D12 persistence (`RESULTS_METADATA_KEY`),
history rehydration (`extractResults`), and the D6 stream parser (`extractProductPart`) **all** flow
through `productResultsPartSchema`. Extending that one schema makes spotlights/comparisons stream,
persist, and rehydrate with **zero** new plumbing — a separate part type would have tripled all four
seams.

**How the invariants survive (the crux — same as D15):**
- **Grounding stays structural.** The model only picks product **ids** + writes the reason; **code**
  resolves the real `Product` from a per-turn **grounding registry** (full records seeded from prior
  turns' persisted results + grown as `find_products` lands groups) and emits the card. An unknown id is
  refused, not invented.
- **The caps hold.** Both tools share the run-local `stepCounter`/`SUPERVISOR_MAX_STEPS` guard, so they
  count as steps and can't loop.

**Behavioral policy (in the supervisor prompt):** clear best fit / "choose one" → recommend
(`recommended`); value ask → recommend (`best-value`); "torn between X and Y" → compare; **ambiguous**
("help me choose") → the bot's judgement, optimising for the buyer clicking (clear winner → recommend
one; close call → compare two). The bot **may also** recommend **proactively** after a search when one
result is a standout likely to convert — used sparingly, with the full grid still shown.

**Accepted costs:**
- A spotlight/comparison about prior products now produces a results group (so it counts toward the
  turn's `results` and gets chips). Intended — it *is* a rendered result.
- The registry only holds products from the recall window (`perPage: 10`); a reference to a product shown
  far earlier than that won't ground and is refused rather than guessed (grounding over reach).

**Alternatives rejected:**
- *New `data-product-recommendation` / `data-product-comparison` part types* — cleaner separation but
  triples the stream/persist/rehydrate/FE plumbing for what is just products + presentation metadata.
- *Prose-only follow-ups (status quo)* — the supervisor could already recommend/compare in text; it
  produced no focused, clickable affordance, which is exactly the conversion lever this adds.
