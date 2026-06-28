# Future Work — Deferred Scope

Deliberately out of scope for this assignment, captured here so the cuts are intentional rather than
forgotten. See [USER_STORIES.md](USER_STORIES.md) for what *is* in scope. Story IDs in parentheses
refer to where each item originally lived before being deferred.

## Security & Abuse Controls

- **Stay-in-lane / prompt-injection refusal** (was US-6.1) — decline out-of-scope or manipulation
  attempts and redirect to shopping, without revealing system internals.
- **Query rate-limiting / abuse control** (was US-6.3) — cap requests per session and bound model
  calls/output per turn.
- *Why deferred:* the app runs locally with the developer's own API key — no untrusted multi-tenant
  traffic — so these are low-risk for the assignment. Grounding (US-5.1) and graceful failure
  (US-5.2) stay in scope because they protect correctness/UX, not just abuse surface.

## User Profile & Personalization (UI-heavy parts only)

The cheap backend of personalization is now **in scope** via Mastra working memory (USER_STORIES
Epic 7: learn + persist prefs, personalized replies, first-time conversational onboarding, see &
reset). What stays deferred is the UI-heavy and retrieval-side work:

- **Dedicated onboarding form** (was US-5.1) — a skippable multi-field form (budget, categories, sizes,
  brands) plus optional demographics (age, gender, occupation, free-text note). In scope today is
  *conversational* onboarding (US-7.3); the form UI is deferred.
- **Full profile editor** (was US-5.2) — view *and edit* every stored field. In scope today is a
  read-only "what's remembered" view + reset (US-7.4); per-field editing is deferred.
- **Retrieval/ranking personalization** (was US-5.4) — fold remembered prefs into the catalog query
  and ranking. In scope today is generation-side personalization (US-7.2); biasing retrieval is
  deferred.
- **Granular privacy controls** (was US-6.6) — view/edit/remove individual items and
  transparency-by-default beyond the minimal show + reset.
- *Why deferred:* these need real frontend or retrieval work; the high-value, low-effort slice
  (remember + personalize) already landed via working memory.

## Analytics & Observability

A thin per-turn log stays in scope as the eval data source (see US-6.1 Testing). The broader
analytics program is deferred:

- **Per-turn event logging / tracing** (was US-8.1) — structured event linking each pipeline stage
  end-to-end, capturing failures outside the model call too.
- **Intent & edge-case analytics** (was US-8.2) — intent distribution and edge-case rates
  (off-catalog, no-results + constraint relaxed, refinement frequency, guardrail-refusal rate).
- **Discovery success & engagement** (was US-8.3) — zero-result/fallback rate, card engagement,
  thumbs up/down.
- **Cost & performance metrics** (was US-8.4) — latency per turn (by stage), tokens/cost by model,
  error/timeout rates.
- **Business / commerce metrics** — conversion rate, conversation-to-cart, recovered revenue,
  margin-aware performance. Left out because DummyJSON has no real checkout, so these would be vanity
  numbers here. Add them once there's a real cart/checkout to attribute against.

## Performance Budget

- **Latency budget + timeouts + model selection** (was US-6.4) — run external calls under a latency
  budget with timeouts, and route simpler tasks to the cheaper/faster model.
- *Note:* a basic loading/typing indicator is the minimum worth keeping for UX even if the rest is
  deferred.

## Classifier-Level Follow-up Resolution (partial today)

- **What works now (US-4.5 mechanism):** the generator agent holds conversation memory (thread + working
  memory), so replies are context-aware.
- **What's deferred:** the *classifier* doesn't yet see prior turns, so an implicit refinement
  ("show me cheaper", "the second one") isn't resolved into a new retrieval against the previous query.
  Completing this means feeding recent thread messages (read-only) into the classify step so it can
  rewrite the follow-up into a full search. Deferred to keep the classify step a single, stateless LLM
  call for now.

## LLM-Assisted Input & Follow-ups

- **Query autocomplete** — as the user types, use the LLM to predict and complete the request inline
  (ghost-text suggestions), grounded in the catalog so completions point at things actually for sale
  ("running shoes under $..." → "$80"). Debounce keystrokes and cache to keep cost/latency sane.
- **Suggested follow-ups** — after each answer, surface 2–3 tappable next-step chips the model proposes
  from the conversation and results (e.g. "show cheaper alternatives", "compare the top two", "only
  in-stock"), turning discovery into a guided flow instead of a blank prompt.
- *Why deferred:* both are conversational-polish features that raise model calls per turn; the core
  free-text loop works without them. Revisit alongside the Performance Budget so the extra calls run
  under the same latency/cost guardrails.

## Richer Product Views

- **Product detail view / "tell me more"** (was US-2.2) — drill into a single product via
  `/products/{id}` to show full description, brand, rating, availability, warranty, shipping,
  dimensions/weight, SKU, and additional images. Reference-resolvable ("tell me more about the second
  one"). Deferred because the required card (title/description/price/image) already covers core
  discovery.
