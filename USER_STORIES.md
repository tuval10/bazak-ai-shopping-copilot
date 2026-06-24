# User Stories — Bazak AI Shopping Copilot

A conversational shopping copilot that helps users discover products from the catalog through
natural-language chat. Stories are written from the user's perspective; bullet points are the
acceptance criteria we agreed on. Edge-case behaviors are tagged **Decision:** for traceability.

This file is scoped to what we're building for the assignment. Deliberately deferred features live in
[FUTURE.md](FUTURE.md) so the cuts are intentional, not forgotten.

Primary role: **"As a Bazak shopping copilot user…"** (referred to below as *user*).

---

## Epic 1 — Conversational Product Discovery

### US-1.1 — Discover products through conversation
As a user, I want to describe what I'm looking for in plain language so that I find relevant
products without learning filters or search syntax.

- The user types a natural-language request (e.g. "wireless headphones under $100").
- The system understands intent, retrieves matching products from the catalog, and responds in chat.
- The response includes a short, helpful summary alongside the product results.

### US-1.2 — Translate intent into a catalog search
As a user, I want my words mapped to the right catalog query so that results actually match what I meant.

- Stated attributes (category, price range, brand, rating, keywords) are extracted from the message.
- Subjective terms are mapped to concrete signals (e.g. "cheap" → low price / price sort,
  "cool" / "best" → high rating or popularity).
- **API reality — client-side filtering:** DummyJSON has *no* server-side filter for price, rating,
  brand, or stock (only keyword `q`, `category/{slug}`, `sortBy`/`order`, `limit`/`skip`). So a query
  like "phones under $500" is: pick the best endpoint (keyword search or category) → fetch → filter
  the unsupported attributes (price/rating/brand/stock) client-side → sort. The bot chooses the
  endpoint that best fits the intent rather than assuming one API call can express the whole query.

### US-1.3 — Split a single message into multiple searches (multi-intent)
As a user, I want one message that asks for several things to be handled in full so that I don't
have to send them one at a time.

- **Decision:** *Decompose + answer all.*
- A message containing multiple intents (e.g. "a phone under $500 **and** a laptop bag") is split
  into separate single-queries.
- Each sub-query is retrieved independently and results are rendered grouped per intent in one response.

### US-1.4 — See more results for the same query (pagination)
As a user, I want to ask for more results without restating my query so that I can browse beyond the
first batch when the top picks aren't quite right.

- When more matches exist than were shown, the bot **says so** (e.g. "Showing 5 of 24 — want to see
  more?") rather than silently truncating.
- "Show me more" / "next" fetches the **next page** of the *same* query (catalog `limit`/`skip`),
  carried over from context (see US-4.5) — it does not re-run or change the query.
- Already-shown products are not repeated; when the last page is reached, the bot says there are no
  more results.

### US-1.5 — Sort / order results
As a user, I want to control the order results come back in ("cheapest first", "best-rated") so that
the most relevant options surface at the top.

- Ordering maps to the catalog `sortBy` + `order` params (e.g. `price`/`asc`, `rating`/`desc`).
- Ordering intent can come explicitly ("sort by price") or implicitly from subjective terms
  ("cheap" → price asc, "best" / "top-rated" → rating desc; see US-1.2).
- Where the relevant attribute isn't server-sortable in combination with a needed filter, ordering is
  applied client-side after retrieval (see US-1.2 API reality).

### US-1.6 — Map to real catalog categories & browse by category
As a user, I want my words matched to the right catalog category so that "phones" finds smartphones
and I can browse a whole category.

- User category terms are resolved to a valid catalog category/slug (e.g. "phones" → `smartphones`)
  using the catalog category list (`/products/categories`).
- The user can browse an entire category (`/products/category/{slug}`), with pagination (US-1.4).
- This mapping backs **US-4.2** ("suggest nearest category") — suggestions are drawn from real
  catalog categories, not invented ones.

### US-1.7 — Availability & deals awareness
As a user, I want to know what's in stock and what's on sale so that I don't pick something
unavailable or miss a discount.

- Product results surface **availability** (`stock` / `availabilityStatus`, e.g. "In stock",
  "Low stock", "Out of stock").
- Results surface **deals** when present (`discountPercentage`), showing the discounted price.
- The user can ask for these ("what's on sale", "only in-stock"); since the API has no server-side
  filter for stock/discount, it's applied client-side after retrieval (see US-1.2 API reality).

---

## Epic 2 — In-Chat Product Rendering

### US-2.1 — See products as cards inside the chat
As a user, I want results shown as rich cards in the conversation so that I can evaluate options at a glance.

- Each product renders as a UI card (not plain text) including: **title, short description, price, image.**
- Multiple results render as a scannable group within the chat flow.

---

## Epic 3 — Conversation Persistence & Management

### US-3.1 — Keep my chat across refreshes
As a user, I want my conversation to survive a page reload so that I never lose my place.

- Conversation history persists across browser refreshes and reopening the page.

### US-3.2 — Start a new conversation
As a user, I want to start a fresh conversation so that a new topic isn't tangled with an old one.

### US-3.3 — See and resume previous conversations
As a user, I want a list of my past conversations and the ability to reopen any of them so that I
can pick up where I left off.

- Previous conversations are listed (with enough context to recognize them).
- Selecting one restores its full prior state and lets the user continue it.

### US-3.4 — Search my previous conversations
As a user, I want to search/filter my conversation list so that I can find a past chat without
scrolling through all of them.

- The user can search conversations by text (e.g. a product or keyword that appeared in the chat,
  and/or the conversation title).
- Matching conversations are shown and can be resumed (per US-3.3).
- An empty search restores the full list; a no-match search says so clearly.

---

## Epic 4 — Intent Handling & Edge Cases

### US-4.1 — Ambiguous / subjective queries
As a user, I want a vague request like "something cheap and cool" to still get me somewhere useful
so that I'm not stuck restating myself.

- **Decision:** *Assume + show + offer refine.*
- The system maps the subjective request to a best-guess search, shows results immediately, and
  invites refinement (e.g. "Here are some popular budget picks — want me to narrow by category?").
- It does **not** block on a clarifying question when it has enough signal to make a reasonable guess.

### US-4.2 — Off-catalog shopping requests
As a user, I want a request the catalog can't fulfill (e.g. "a flight to Tokyo") handled honestly
so that I'm not misled.

- **Decision:** *Decline + suggest nearest category.*
- The system clearly states it can't fulfill that request, then offers the closest catalog match if a
  reasonable one exists (e.g. luggage / travel accessories) instead of forcing irrelevant results.

### US-4.3 — Unrelated / chit-chat input
As a user, I want greetings or small talk ("hi", "what's your name") met with a human touch so that
the experience feels friendly, not robotic.

- **Decision:** *Brief friendly reply + redirect.*
- The system gives a short, warm reply and steers back to shopping
  (e.g. "I'm your Bazak shopping copilot — what are you shopping for today?").

### US-4.4 — No / empty catalog results
As a user, I want to be told honestly when nothing matches, plus a way forward, so that I'm not shown
fake products or left at a dead end.

- **Decision:** *Admit + relax + suggest.*
- When a valid query returns nothing, the system says so plainly, relaxes the tightest constraint, and
  shows the nearest alternatives.
- The message **names which constraint was relaxed and the actual value found**, so the user
  understands *why* (e.g. "No phones under $50 — phone prices start at **$100**, here are the cheapest
  available").
- The system never invents products that aren't in the catalog (see US-5.1).

### US-4.5 — Follow-up & refinement turns
As a user, I want to refine results conversationally ("show me cheaper", "the second one", "in red")
so that I can iterate naturally without restating the whole query.

- **Decision:** *Full context carryover.*
- The system carries the prior query and last-shown results across turns.
- It resolves **implicit refinements** ("cheaper", "different color") against the active search and
  **references** ("the second one", "that one") against the last-shown results.

---

## Epic 5 — Quality, Grounding & Reliability

### US-5.1 — Grounded answers, no fabrication
As a user, I want every product and price to be real so that I can trust what I'm shown.

- The bot only presents products actually returned by the catalog API.
- It never invents a product, price, image, or spec; if it doesn't have the data, it says so.
- Single biggest trust failure for shopping bots — treated as a hard rule, not a best-effort.

### US-5.2 — Graceful failure
As a user, I want a helpful message instead of a crash when something breaks so that I can keep going.

- If the catalog API or the model errors or times out, the bot returns a friendly fallback and a
  suggested next step — never a crash, blank screen, or stack trace.
- Partial failures in a multi-intent request degrade gracefully (return what succeeded, flag what didn't).
- Covers conversation-storage failure scenarios too: storage quota exceeded, corrupted saved state,
  and the user clearing storage mid-conversation are handled without losing the app or crashing.

---

## Epic 6 — Testing & Evaluation

### US-6.1 — Validate the core flow
As the team, I want automated checks over the core path so that regressions are caught.

- Tests/evals validate the end-to-end flow:
  **User Input → Intent Understanding → Product Retrieval → Response Generation → Product Rendering.**
- Coverage includes the edge cases in Epic 4 (ambiguous, off-catalog, chit-chat, no-results, follow-ups).
- A lightweight per-turn log (input → detected intent(s) → retrieval params → result count → response)
  is kept as the data source for evaluation. (Broader analytics is deferred — see FUTURE.md.)

---

## Decision Log (edge cases)

| Case | Decision |
|------|----------|
| Ambiguous / subjective query | Assume + show results + offer refinement |
| Off-catalog request | Decline + suggest nearest catalog category |
| Chit-chat / unrelated | Brief friendly reply + redirect to shopping |
| Multi-intent | Decompose into single-queries + answer all, grouped |
| No / empty results | Admit honestly + relax constraint (state which + value) + suggest nearest |
| Follow-up / refinement | Full context carryover (implicit refinements + references) |
| Grounding & reliability | Only show real catalog data (no fabrication) · graceful failure + storage-failure handling |
| Retrieval (API limits) | No server-side price/rating/brand/stock filter → pick best endpoint (search / category) + filter & sort client-side · map terms to real categories · surface availability + deals |
