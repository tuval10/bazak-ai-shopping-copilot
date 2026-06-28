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
AI SDK stream** alongside the assistant text — one `product-results` part per intent. assistant-ui (D8)
renders each part with a registered **tool UI** (`makeAssistantToolUI`) as a product-card group (US-2.1).

Content per part is unchanged; only the envelope is now an AI-SDK-native part rather than a field in one
JSON blob:

```jsonc
// each streamed as its own typed "product-results" part, not a single response body:
{ "intent": "phone under $500", "products": [ {…}, {…} ] }
{ "intent": "laptop bag",       "products": [ {…} ] }
```

> **Supersedes** the original D6 (a single JSON body: `{ message, results: [...] }` rendered by a custom
> client renderer). Same content, AI-SDK-native envelope.

**Why amended:** with assistant-ui as the FE chat layer (D8), the idiomatic "generative UI" path is
*typed stream parts → a component registered per part type*. Streaming results as parts (instead of one
end-of-turn JSON body) lets cards render **as each intent resolves**, plugs straight into assistant-ui
with a single `makeAssistantToolUI` registration, and keeps the assistant text and the card groups in
one ordered message. Because the **D2 pipeline (not the model) produces the results**, the generate step
**writes these as synthetic tool/data parts** onto the stream — the model never "decides" to call a tool.

**Why (unchanged):** server shapes data, client owns presentation (US-2.1); multi-intent (US-1.3) falls
out naturally as multiple parts. Grounding (US-5.1) stays server-enforced — only products actually
returned by the catalog are ever emitted.

**Alternatives rejected:**
- *Single custom JSON response body* (the original D6 shape) — simplest, but bypasses assistant-ui's
  part-based rendering, forces a bespoke message renderer, and can't stream cards per intent.

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

## D8 — Front-end chat layer: assistant-ui  ·  *added 2026-06-28*

**Decision:** Build the chat UI on **assistant-ui** — a prebuilt, accessible React chat shell (thread,
composer, streaming, autoscroll, edit/regenerate) with a first-class **Mastra runtime adapter**. It
consumes the same AI SDK v5 stream Mastra emits via `@mastra/ai-sdk` (D7), so it sits *on top of* the
`useChat` transport rather than replacing it. Custom **product cards render as assistant-ui tool UIs**
(`makeAssistantToolUI`) bound to the streamed `product-results` parts (D6).

**Why:**
- **Less plumbing** — the prebuilt shell removes the generic chat work (message list, composer,
  autoscroll, streaming states, accessibility), so effort goes into the bespoke part: the product-card
  groups.
- **Native fit** — first-class Mastra adapter + AI-SDK-native parts means per-intent card rendering (D6)
  is a single `makeAssistantToolUI` registration, not custom glue. The only seam is server-side: the
  generate step writes results as synthetic tool/data parts (the pipeline, not the model, produces them).

**Alternatives rejected:**
- *Hand-built components on `useChat`* — most transparent and maximum control, and the path the
  assignment's "simpler solution you fully understand" slightly favors. Rejected because we'd hand-build
  the generic chat shell; the custom/interesting part (cards) is bespoke either way, so the shell is the
  cheap thing to delegate to a library. Close call — chosen against for build speed + UX polish.
- *CopilotKit* — built to bolt a copilot **onto an existing app** (in-app actions, shared app state,
  sidebar assistant that drives your UI); heavier and the wrong shape for a chat-first app. Mastra-
  compatible, so it's a fit mismatch, not a compatibility one.

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

**D9a — one custom route (`registerApiRoute`):** `GET`/`DELETE /api/profile` reads and resets per-user
working memory (US-7.4) — there is no built-in working-memory HTTP route. **Conversation search (US-3.4)
is client-side** (filter the thread list by title) — there is no built-in thread text-search endpoint.

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
