# Architecture Decisions — Bazak AI Shopping Copilot

A running log of architectural decisions, why they were made, and the alternatives rejected.
Lightweight ADR style. See [USER_STORIES.md](USER_STORIES.md) for scope and [FUTURE.md](FUTURE.md)
for deferred work. The body below reflects the **current** design; decisions that were later
superseded live in **[Outdated decisions](#outdated-decisions)** at the end (which is why the numbering
below skips D2, D13, D14). Entries are **Accepted**; revised or newly added entries note their date.

---

## D1 — Thin local backend (not client-only)

**Decision:** The browser is a thin client; orchestration, retrieval, and the OpenAI key live on a
local server. The client POSTs a turn and renders the response.

**Why:** Keeps the API key out of the browser, lets the turn be unit-tested/evaluated in
isolation (US-6.1), and gives a clean seam between UI and logic.

**Alternatives rejected:**
- *Client-only* (browser calls OpenAI + DummyJSON directly) — simplest to run, but exposes the API
  key and is hard to test/eval.

---

## D3 — Server owns conversation persistence

**Decision:** The server owns all conversation state. The client holds only the current conversation
id (the Mastra **thread id**, D5) and sends `{ message, threadId, resourceId }` per turn; on refresh it
re-fetches the conversation from the server by id. The concrete endpoints are **Mastra's built-in
memory-thread + workflow-stream routes** (D9) over the **Mastra Memory** store (D4) — the server adds no
hand-rolled REST layer beyond the single `/profile` route (D9a).

**Why:** Persistence (US-3.1) is satisfied server-side; the client stays genuinely thin; there is no
server-side *session* coupling beyond loading a conversation by id.

**Alternatives rejected:**
- *Client-owned persistence* (localStorage/IndexedDB, stateless server) — viable, but a server-owned
  store keeps transcripts off any one browser and centralizes failure modes.
- *Custom REST API over Mastra Memory* — a hand-rolled `/api/conversations…` table (the original D3
  shape); dropped for Mastra's built-in endpoints (D9), which already cover the whole thread lifecycle.

---

## D4 — Conversation storage: Mastra Memory (LibSQL)  ·  *revised 2026-06-28*

**Decision:** Use **Mastra Memory** as the single conversation store — **threads** hold the message
transcript and **working memory** holds per-user preferences — backed by **LibSQL** (Mastra's
default; a local SQLite engine). The persistence endpoints (D3) are thin wrappers over the Mastra
Memory API.

> **Working memory holds durable preferences only** (name, lasting budget, favoured/disliked
> categories/brands) — never the current query or a running conversation summary. The scope is
> **resource** (persists across all of a user's threads), so storing transient query phrases would leak
> them into later, unrelated conversations and corrupt the turn. The supervisor instructions (D15) + the
> working-memory schema enforce this; `DELETE /profile` (D9a) clears it for a fresh slate before testing.

**Why:**
- We committed to **Mastra** for orchestration (D7). Letting it also own persistence removes an entire
  hand-rolled layer (transcript write/replay + conversation list/search) — native **threads** give
  list/resume/search out of the box (US-3.x).
- **Working memory** delivers the personalization loop (Epic 7) at near-config cost — learn, persist
  per-user, personalize replies — which is what motivated the change.
- **Semantic recall** (vector search over past messages, LibSQL + FastEmbed) is then available in the
  same store as the agentic flow grows (D7); messages are already there.
- Single store, less code, fewer moving parts to defend.

**Failure handling (US-5.2):** LibSQL is a durable embedded SQLite engine (WAL, atomic commits);
handle write/disk errors gracefully and never surface a raw DB error to the user.

**Alternatives rejected:**
- *Append-only JSONL, one file per conversation* — the prior choice (original D4); clean for an
  immutable transcript and transparent to inspect, but a second bespoke store that duplicates what
  Mastra threads give for free and can't back semantic recall. Its concurrency/portability edge is weak
  for a single-user local app, and crash-safe/greppable transparency is now covered by Mastra Studio +
  OpenTelemetry tracing. Reasonable, but redundant once we're on Mastra.
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

**Decision:** The server produces per-intent product results — one entry per intent, each with its own
`products` array (multi-intent → multiple entries; single intent → one) — and **streams them as typed
parts on the workflow stream** alongside the assistant text, one `product-results` part per group
(emitted via `writer.custom({ type: "data-product-results", data })`). Our own `ProductResults`
component (D8) renders each part as a product-card group (US-2.1).

Content per part (each its own typed part, not a single response body):

```jsonc
{ "intent": "phone under $500", "products": [ {…}, {…} ] }
{ "intent": "laptop bag",       "products": [ {…} ] }
```

> **D16 extension:** the part gains an optional `display` discriminator (`grid` | `recommendation` |
> `comparison`) plus `badge`/`winnerId`, so spotlights and comparisons ride this **same** part type
> through streaming, persistence (D12), and rehydration unchanged.

**Why amended:** streaming results as typed parts (instead of one end-of-turn JSON body) lets cards
render **as each group resolves** and keeps the assistant text and the card groups in one ordered turn.
The **part is written by code** — the supervisor's tools call `writer.custom(...)` with products
resolved **by id** (the model never authors card data, see D15/D16) — so grounding (US-5.1) is
structural: only products the catalog actually returned are ever emitted.

**Why (unchanged):** server shapes data, client owns presentation (US-2.1); multi-intent (US-1.3) falls
out naturally as multiple parts.

**Alternatives rejected:**
- *Single custom JSON response body* (the original D6 shape) — simplest, but can't stream cards per group
  as each resolves; the part-based envelope gives progressive rendering for little extra cost.

---

## D7 — Orchestration framework: Mastra  ·  *added 2026-06-28*

**Decision:** Build the orchestration layer on **Mastra** — a TS-native **agent + workflow + memory**
framework built on top of the Vercel AI SDK. We use the *whole* stack, not one piece: the turn runs as a
Mastra **workflow** (`pipeline`) whose single step hosts a **supervisor agent loop** with grounded tools
(D15); conversation + preference storage use Mastra **Memory** (D4); the client streams over the workflow
stream via `@mastra/client-js` (D8/D9); Studio + OpenTelemetry trace every step/agent/tool.

**Why:**
- **Studio traceability / debugging** — Mastra Studio + OpenTelemetry give visual step/agent/tool-level
  traces of each run. This became *load-bearing* once the turn went agentic: a multi-round, model-driven
  loop is only defensible if you can see every tool call it made.
- **Future-proofing — *(realized)*** — the flow was deterministic at first but went **agentic** (via the
  retired D13 hybrid, then D15's supervisor loop) on these **same** workflow + agent + memory primitives,
  with **no framework change** — exactly the growth this anticipated.
- Matches the team's stack; first-class evals serve the testing requirement (US-6.1); reuses AI SDK at
  the UI edge so we still get best-in-class SSE streaming.

**Alternatives rejected:**
- *Vercel AI SDK direct* — lightest and simplest to fully explain, and Mastra is built *on* it (so we keep
  its streaming either way). But no Studio/tracing, no first-class evals, no Memory primitive, and no
  workflow engine — we'd hand-roll persistence, working memory, and the bounded-loop shell ourselves.
- *LangChain / LangGraph (JS)* — powerful graph + durable checkpoints, but Python-first with grafted
  TS that trails releases, heavier, weaker serverless story.
- *LibreChat* — a finished self-hosted chat product; wrong shape for a bespoke discovery flow with
  custom cards and our own persistence.
- *Fully custom* — maximum control, but reinvents orchestration/streaming/memory/tracing we'd rather not own.

**Model selection:** `gpt-5.4-mini` for both the supervisor and the discovery finder (D15); `gpt-5.4-nano`
is no longer on the turn path (its judgments proved unreliable, D13).

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
  `chatRoute`), **not a workflow stream** — and our front door is the **workflow** stream
  (`/api/workflows/pipeline/stream`). Bridging would mean adding an agent-shaped conversion route purely
  to satisfy the UI.
- `makeAssistantToolUI` — the exact API the original D6/D8 leaned on to render cards — is **deprecated**
  (superseded by a toolkit API + a backend-pushed data-UI path), so the "single registration" advantage
  evaporated.
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
| Run a turn → stream text + `product-results` parts | `POST /api/workflows/pipeline/stream` (`inputData: { message, threadId, resourceId }`) | US-1.x, US-2.x, US-4.x, US-7.x |
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
`data-product-results` parts (D6); on refresh/resume they come back from the persisted metadata. The
turn's chips and finders are persisted under the same metadata, so "show me more" reuses the prior
finder and the grounding registry can be re-seeded (D15/D16).

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

## D15 — Supervisor agent loop (one `converse` step) with grounded tools  ·  *added 2026-06-29*

**Decision:** Run the whole turn as one workflow step (`converseStep`) that runs a **supervisor agent**
which *drives* the turn via grounded tools (`find_products` here; D16 adds `recommend_product` +
`compare_products`):
- It decides **whether** to retrieve at all. For a follow-up about products already shown ("which do you
  recommend?", "what's the difference?") it **answers directly** from conversation memory + a
  PREVIOUSLY-SHOWN-PRODUCTS block — **no finder runs**.
- For a shopping request it calls `find_products` **once per angle** (multi-intent → several; an
  off-catalog ask → a few adjacent briefs it then declines honestly while merchandising). Each call
  carries a rich natural-language **brief** (the situational "why"), not just keywords.
- Each call **returns its grounded results to the supervisor** (a lean narrative), which it reads to
  decide next steps and to write the reply — weaving **per-item reasoning into the prose** (kept in the
  message text; no per-card schema change).

**Why (over the retired D13 hybrid):** the old orchestrator never saw results, so it couldn't *decide-and-
synthesize* (skip discovery, react to what was found, weave per-item reasoning) — and it always
retrieved even when the answer was already on screen. A supervisor that owns the turn handles all three.

**How the invariants survive going fully agentic** (the crux — the loop is agentic, the guarantees are
code):
- **Grounding stays structural.** `find_products` runs the *same* finder sub-agent (`discovery`) as the
  retired D13 design (selects products **by id** → code resolves real `Product`s) and **streams the cards
  itself** via the workflow `writer` (`data-product-results` parts). The model gets only a lean view to
  reason over; it never authors a card. The output contract (`{ message, results, chips }` + the stream
  parts + D12 rehydration) is **unchanged** — the frontend and shared schemas are untouched.
- **Provable finder AND step caps despite an agentic loop.** Two run-local counters in `find_products`
  hard-stop the turn in code: one returns `limitReached` once `MAX_PRODUCT_FINDERS` finders have actually
  run (the catalog-cost ceiling), and one counts **every** call (including refused ones) and refuses past
  `SUPERVISOR_MAX_STEPS` tool-turns. So the supervisor cannot loop unbounded even if the framework's soft
  `maxSteps` is ignored — the soft `maxSteps` on `.generate()` stays as a belt-and-suspenders bound.
  `FINDER_MAX_STEPS` still bounds each inner finder.
- **Deterministic `relaxed` + dedup + continuation.** The finder's `relaxedFactFor`/hard-constraint
  enforcement/`assembleGroups` are reused unchanged. Already-shown ids are loaded once per turn and
  excluded from every call, so "show me more" pages forward with no repeats (the guarantee from the
  retired D14, now enforced inside the loop rather than by a dedicated continuation step).

**Roster:** one **`supervisor`** agent (holds Memory → persists the transcript US-3.1 + learns durable
preferences US-7.1, and writes all prose: merchandise, decline, chit-chat) drives a stateless
**`discovery`** finder sub-agent through the tool. This folds in the retired D13 `orchestrator` +
`generator` + `concierge` roles. Model: `gpt-5.4-mini` (judgment-heavy; nano was unreliable, per D13).

**Accepted costs:**
- The supervisor's **prose** is grounded by the lean summary the tool returns (it could mis-state a
  price in prose) — the **cards remain authoritative** (code-emitted, by id).
- Multi-round tool use means a turn can be a few sequential finder calls before the reply (higher
  latency/cost than a single fan-out) — bounded by the two caps and accepted for the
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

---

# Outdated decisions

Decisions that were in force at some point but have since been **superseded**. Kept for the record —
they explain how the current design above was reached. Each opens with what replaced it and why.

---

## D2 — Explicit pipeline orchestration (not a single agent + tools)  ·  *added 2026-06-27*

> **⛔ Outdated — superseded by D13, then D15.** The fixed `classify → route → retrieve → generate`
> pipeline was replaced by a bounded **supervisor agent loop** (D15). D2's *principle* — contain
> non-determinism behind testable seams — **survives in a new form**: it now lives in the **code around**
> the agentic loop (grounding by id, hard finder/step caps, dedup, persistence), not in a deterministic
> step chain. The model tier also moved to `gpt-5.4-mini` throughout (D13/D15); nano left the turn path.

**Decision (original):** Layer 4 is a deterministic pipeline:
`classify + extract → route → plan + retrieve → generate`. The LLM is used for two discrete
sub-tasks (classify, generate); everything between is plain, testable code.

**Why (at the time):** Each arrow is a testable seam, cost/latency are predictable (two LLM calls per
turn), non-determinism is boxed into two well-defined spots, and it's straightforward to defend
("I control every step"). Matched the assignment's "a simpler solution you fully understand."

**Alternatives rejected (at the time):**
- *Single agent loop with tools* (model decides which tools to call) — more flexible and less code
  for open-ended flows, but non-deterministic, harder to eval, and pricier per turn.
  > **Reversed by D15:** we *did* adopt an agent loop after all — but a **bounded** one inside a
  > workflow shell, with grounding-by-id and hard finder/step caps enforced in code, which answers
  > exactly these objections (non-determinism contained, eval seams preserved, cost capped).

---

## D13 — Agentic orchestrator + sub-agents (hybrid workflow shell)  ·  *added 2026-06-29*

> **⛔ Outdated — superseded by D15 (same day).** The `orchestrate → discover → generate` three-step
> spine and the **orchestrator / concierge / generator** trio below are **retired**, replaced by a single
> **supervisor agent loop**. What carries forward **unchanged** into D15: the **finder sub-agent**
> (`discovery`) with its `product_search`/`category_browse` tools, **grounding by construction**
> (ids → real products), the cached **category provider** (list + counts injected as prompt text), and
> the **caps** (now `MAX_PRODUCT_FINDERS` + `SUPERVISOR_MAX_STEPS` + `FINDER_MAX_STEPS`). Read this entry
> for the rationale behind those mechanisms; read **D15** for the current shape of the turn.

> **Amended D2.** D2's *principle* — a deterministic, testable spine with non-determinism boxed into
> discrete LLM steps — still stood here. What changed at the time: the LLM seams and the retrieval step
> became an **orchestrator + sub-agents**, and the **finder became a model-driven, tool-using agent**
> that owns retrieval + relaxation by calling catalog search tools. The spine was still a **Mastra
> workflow** (D7): the agent-with-tools loop was *scoped inside the single `discover` step* (bounded by
> `FINDER_MAX_STEPS`), not a top-level supervisor that owns the whole turn.

**Decision (original):** Replace `classify → route → retrieve → generate` with `orchestrate → discover →
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
- **generator** — grounded prose; held conversation memory (D4).

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
current behavior). The list is injected as **prompt text** into both the planner and the finder, so the
model routes/keywords against real slugs. It is **never** exposed as a raw endpoint-list tool — the
finder *retrieves* through the two scoped search tools (`product_search`, `category_browse`), and the
category list is context it picks slugs from. *(Carried forward into D15 unchanged — the supervisor now
consumes this context.)*

**Per-category counts (one call, not 24):** each category line carries its size — `slug — name (N items)`
— so the planner can judge how thin a category is and broaden a finder when the best-fit category holds
only a couple of items. The counts come from a **single** `/products?limit=0&select=category` request
(the whole 194-product catalog, category field only — ~7 KB) tallied client-side, **not** 24 per-category
calls; it runs concurrently with the category-list fetch behind the same 24h cache (two cached calls/day
total). Counts are a **nice-to-have**: if that one call fails, the list still serves *without* counts (the
`(N items)` suffix is simply dropped) rather than failing the turn. *(Also carried forward into D15.)*

**Grounding by construction (extends US-5.1):** the model never *authors* product data. The finder sees
only a **lean read-only view** (id/title/price/rating/stock/…) returned by the search tools and selects
products **by id**; code resolves those ids → real `Product` objects captured from the tool calls,
dropping any unknown/hallucinated id. Prices, images, and the `relaxed` from/to values flow catalog →
typed stream parts → never authored by an LLM. *(This principle is the spine of D15/D16.)*

**Model selection (updated D2/D7):** the orchestrator, discovery, and concierge run on **`gpt-5.4-mini`**,
not nano — the per-turn judgments (hard-vs-soft constraints, what *not* to invent, which axis to relax
without drifting off-topic) are harder than "classify/extract", and nano was unreliable.

**Why (over the prior deterministic flow):** the old flow returned one focused result set — it couldn't
*merchandise*: relax a too-tight budget across several framed angles, or present adjacent items for an
off-catalog ask (US-4.1/4.2/4.4).

**Why scoped-agentic over a full supervisor (at the time):** the agentic loop was *scoped* to the finder,
inside a single workflow step, with output grounded by code and hard constraints re-enforced outside the
model — keeping the planner and generator as separate deterministic seams. **D15 reversed this** in favor
of a full supervisor that owns the turn, after concluding the planner couldn't decide-and-synthesize
without seeing results.

**Alternatives rejected (at the time):**
- *Full supervisor owning the whole turn* — rejected here for grounding/eval reasons, then **adopted in
  D15** once grounding was shown to survive via id-based resolution + code caps *around* the loop.
- *Deterministic budgeted relaxation loop (the original D13: a relaxation-planner agent + code-executed
  axes)* — replaced; it made catalog calls invisible in traces and split retrieval between a planner agent
  and executor code; the tool-using finder is traceable and keeps the relax decision with the agent that
  sees the results.
- *Regex gate for hard-vs-soft / invented constraints* — tried and removed; the LLM should judge.
- *Workflow `.parallel()` / `.foreach()` for fan-out* — a static array / isolated iterations don't fit a
  dynamic finder count over shared per-turn state.

---

## D14 — "Show me more" via deterministic continuation  ·  *added 2026-06-29*

> **⛔ Outdated — mechanism superseded by D15.** The *guarantee* — "show me more" returns the **next**
> products with **no repeats**, by excluding already-shown ids — **still stands**. What's gone is the
> dedicated `continuation` flag + reused-finder step: the supervisor loop now loads every already-shown id
> once per turn (from D12 metadata) and excludes them from **every** `find_products` call, so paging
> forward is enforced inside the loop. Dedup is still plain code; the model still does no id bookkeeping.

**Decision (original):** A pure "show me more / next / others" turn is handled as a **continuation**, not
a re-plan. The orchestrator flags `continuation: true` and emits no finders; the discover step then
**reuses the prior turn's finder** and **excludes every already-shown product id**, paging forward. Both
the prior finder and the shown ids are read from the **persisted assistant-message metadata** (D12) —
the turn's finders are persisted alongside its results under a `finders` metadata key.

**Why:** "show me more" must return the *next* products with no repeats. Letting the planner re-plan a
vague follow-up was wrong twice over: it **invented constraints** (a fabricated `$150–$500` band) and
**repeated products** (no notion of what was already shown). Both are deterministic concerns:
- *No repeats* — exclude shown ids (read from D12 metadata) before paginating.
- *No re-invention* — a continuation reuses the exact prior finder, so there is nothing to re-extract or
  fabricate; the original constraints carry forward unchanged.

**Why not push "what was shown" into the model:** it never sees product ids (grounding — D13), and LLMs
are unreliable at exact id bookkeeping across turns. Shown-id tracking is deterministic state, so it lives
in code, seeded from the store we already write each turn. *(D15 keeps exactly this stance — the
exclusion set is code, not a model responsibility.)*

**Failure handling:** best-effort — if no prior context is found, it falls back to a normal turn
(degrades, never crashes).

**Alternatives rejected (at the time):**
- *Let the planner re-plan "show me more"* — the observed behavior: invented filters + repeated products.
- *A deterministic citation check on every constraint* — considered for the broader invented-constraints
  problem, but not adopted; the continuation path removed the need for the common case.
- *Server-side `skip`/offset paging* — viable (DummyJSON supports `skip`), but exclude-by-id over the
  already-fetched window is simpler, robust to re-sorting, and reuses persisted state.
