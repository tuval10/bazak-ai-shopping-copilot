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

## User Profile & Personalization

- **Optional onboarding** (was US-5.1) — skippable, per-field flow for shopping preferences (budget,
  categories, sizes, brands) and optional demographics (age, gender, occupation, free-text note).
- **View & edit profile anytime** (was US-5.2).
- **Learn preferences during conversation** (was US-5.3) — infer and save preferences mentioned in
  chat ("I'm vegan", "budget ~$50"), transparently.
- **Personalized results** (was US-5.4) — bias retrieval/ranking by profile, with clear "why".
- **Profile persistence** (was US-5.5) — saved across refresh and shared across all conversations.
- **Privacy by default** (was US-6.6) — store only what's needed; user can view/edit/remove; be
  transparent about what was remembered.
- *Why deferred:* a sizeable feature not required by the assignment; the core discovery experience
  stands without it.

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

## Richer Product Views

- **Product detail view / "tell me more"** (was US-2.2) — drill into a single product via
  `/products/{id}` to show full description, brand, rating, availability, warranty, shipping,
  dimensions/weight, SKU, and additional images. Reference-resolvable ("tell me more about the second
  one"). Deferred because the required card (title/description/price/image) already covers core
  discovery.
