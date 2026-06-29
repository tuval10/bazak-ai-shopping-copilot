# Components — Bazak AI Shopping Copilot

The reusable building blocks that make up the [Conversation screen](SCREENS.md#2-conversation).
This file is the source of truth for *how each piece looks and behaves*; for where they appear, see
[SCREENS.md](SCREENS.md). Behavior traces back to [USER_STORIES.md](../USER_STORIES.md).

Each component follows the same conversational-UI principles used across the app: brief natural
language, clear capability transparency, no dead ends, honest recovery, and accessible
(high-contrast, large tap targets, keyboard- and screen-reader-friendly). See *References*.

Components:

1. [User Message](#user-message)
2. [Bot Message](#bot-message)
3. [Product Catalog](#product-catalog)
4. [Recommendation Spotlight](#recommendation-spotlight)
5. [Product Comparison](#product-comparison)
6. [No Results Found](#no-results-found)
7. [Loading / Bot Thinking](#loading--bot-thinking)

---

## User Message

The user's own turn in the transcript.

- **Content:** the verbatim text the user sent — a natural-language request, follow-up, or refinement
  (US-1.1, US-4.5). No system reinterpretation is shown here; it's a faithful echo of their words.
- **Appearance:** a right-aligned bubble, visually distinct from bot turns (alignment + color), so the
  back-and-forth is scannable at a glance. High contrast for readability across long sessions.
- **Behavior:**
  - Appears **immediately** on send — optimistic, before the bot replies — so the UI never feels stalled.
  - Followed by a [Loading / Bot Thinking](#loading--bot-thinking) indicator while the reply is generated.
- **Accessibility:** announced to screen readers as the user's turn; fully keyboard-navigable.

---

## Bot Message

The copilot's conversational reply — the words around (or instead of) product results.

- **Content:** a short, helpful, natural-language message (US-1.1). Used for:
  - A **summary** that frames product results ("Here are some popular budget picks…") (US-4.1).
  - **Clarifying/refinement invitations** that keep momentum without blocking ("want me to narrow by
    category?") (US-4.1).
  - **Off-catalog declines** that are honest, then suggest the nearest catalog category (US-4.2).
  - **Chit-chat** — a brief, warm reply that redirects to shopping (US-4.3).
  - **Graceful failure** — a friendly fallback plus a suggested next step, never a stack trace (US-5.2).
- **Appearance:** a left-aligned bubble, visually distinct from user turns; may carry a subtle bot
  avatar/label for capability transparency (used sparingly so it doesn't distract).
- **Behavior:**
  - Keep it **brief** — no walls of text; the message complements, not duplicates, the product cards.
  - May be immediately followed by a [Product Catalog](#product-catalog) or [No Results Found](#no-results-found)
    block in the same turn.
  - **Grounded:** never states a product, price, or spec that isn't in the catalog data (US-5.1).
- **Accessibility:** announced as the bot's turn; links and suggested actions are real, focusable controls.

---

## Product Catalog

The in-chat rendering of retrieved products — the heart of [US-2.1](../USER_STORIES.md).

- **Content:** a scannable group of product cards rendered *inside the conversation flow* (not a
  separate page, not plain text). Each card includes:
  - **Title**, **short description**, **price**, and **image** (US-2.1).
  - **Availability** — "In stock" / "Low stock" / "Out of stock" (US-1.7).
  - **Deals** — when a discount applies, the discounted price is shown (US-1.7). The sale price is
    **derived** (`price × (1 − discountPercentage/100)`), not a stored field — the catalog exposes
    `price` and `discountPercentage`, so the struck-through original and the badge come straight from
    the API and only the final price is computed.
- **Grouping:** for a multi-intent message ("a phone under $500 **and** a laptop bag"), results render
  as separate labeled groups, one per intent, within a single bot turn (US-1.3).
- **Behavior:**
  - **Pagination, not truncation:** when more matches exist than shown, the block surfaces a count and
    a *Show more* affordance ("Showing 5 of 24 — want to see more?"). *Show more* loads the **next
    page** of the same query without repeating already-shown products; at the end it says there are no
    more (US-1.4).
  - **Ordering** reflects the requested or inferred sort ("cheapest first", "best-rated") (US-1.5).
  - **Grounded:** every card is a real catalog product; nothing is invented (US-5.1).
- **Appearance:** a consistent card grid/list that stays readable on mobile (large tap targets, legible
  type). Out-of-stock items are visually de-emphasized but still honest.
- **Accessibility:** each card is keyboard-reachable; images carry alt text; price and availability are
  text, not color-only signals.

---

## Recommendation Spotlight

A single product the bot puts forward as **its pick** ([US-2.2](../USER_STORIES.md), US-2.3). Used when
the user asks the bot to choose ("choose one for me", "which is the best value?") and, sparingly, when the
bot proactively highlights a standout after a search to help the buyer commit.

- **Content:** one [Product Catalog](#product-catalog) card promoted into a hero card, with:
  - A **badge ribbon** — **"Recommended"** (a clear best fit) or **"Best value for money"** (a value ask).
  - A short **reason** for the pick (the only model-authored prose; the card facts stay grounded).
- **Variants:** the two badges are the same component with different accent + copy; they're chosen by the
  bot from the user's intent.
- **Behavior:**
  - **Grounded:** the spotlighted product is always one already shown this conversation, picked by id —
    never invented (US-5.1).
  - **Proactive use is sparing** — only when one option genuinely stands out and would help the buyer
    decide; the bot does not spotlight on every turn, and the full grid still stands so the user keeps the
    choice (US-2.2 decision).
- **Appearance:** visually elevated above a normal card (accent border + badge) so it reads as a
  deliberate recommendation, not just another result.
- **Accessibility:** the badge is text (not color-only); the card stays keyboard-reachable with alt text.

---

## Product Comparison

Two products laid **side by side** so a torn buyer can see the trade-off at a glance
([US-2.4](../USER_STORIES.md)). Used for "I'm conflicted between X and Y" and ambiguous "help me choose"
turns where there's no single clear winner.

- **Content:** a two-column layout — each column shows the product's image, title, and price — over a
  **spec table** comparing: **price, rating, availability, brand, discount**.
- **Winner hint:** the bot may mark one column **"Best pick"** (highlighted) when it has a lean; otherwise
  the two are presented evenly.
- **Behavior:**
  - **Grounded:** both products are real, already-shown items picked by id (US-5.1).
  - **Decision — ambiguous asks:** for "help me choose" the bot decides between this side-by-side view and
    a single [Recommendation Spotlight](#recommendation-spotlight) based on whether there's a clear winner,
    optimising for the choice most likely to help the buyer act (US-2.4 decision).
- **Appearance:** aligned rows so values compare cleanly down each column; readable on mobile.
- **Accessibility:** the table is a real table with row labels; the "Best pick" marker is text, not
  color-only.

---

## No Results Found

What renders when a valid query genuinely matches nothing (US-4.4) — and the empty state on the
[Conversations List](SCREENS.md#1-conversations-list) search (US-3.4). Never a blank space or dead end.

- **Content (catalog, US-4.4):** an honest "nothing matched" message that follows *Admit + relax +
  suggest*:
  - States plainly that nothing matched.
  - **Names the constraint that was relaxed and the real value found**, so the user understands *why*
    (e.g. "No phones under $50 — phone prices start at **$100**, here are the cheapest available").
  - Shows the nearest alternatives right below, as a [Product Catalog](#product-catalog) block.
- **Content (conversation search, US-3.4):** a clear "No conversations match '<query>'" with an easy
  way back to the full list.
- **Behavior:** always offers a forward path (relaxed results, a suggestion, or a reset) — the user is
  never stranded. Never fabricates products to fill the gap (US-5.1).
- **Appearance:** calm and non-alarming — this is a normal outcome, not an error. Distinct from the
  [error fallback](SCREENS.md#2-conversation) (US-5.2), which is about something breaking.
- **Accessibility:** the message and the recovery action are announced and focusable.

---

## Loading / Bot Thinking

The feedback shown while the copilot is processing a turn — so the wait never feels like a freeze.

- **When:** from the moment a [User Message](#user-message) is sent until the [Bot Message](#bot-message)
  / [Product Catalog](#product-catalog) arrives; also while *Show more* fetches the next page (US-1.4).
- **Appearance:** a lightweight **typing / thinking indicator** in the bot's position in the transcript
  (e.g. animated dots) — clearly the bot's turn, consistent with [Bot Message](#bot-message) styling.
  Skeleton card placeholders may be shown when product results are expected.
- **Behavior:**
  - Appears promptly so the UI is never silent after a send.
  - For longer waits, a brief status line can set expectations ("Searching the catalog…").
  - Resolves into the actual reply, or into the [error fallback](SCREENS.md#2-conversation) on failure —
    it never spins forever (US-5.2).
- **Accessibility:** exposed as a polite live-region status ("Bot is thinking…") for screen readers,
  not animation-only, so the state is perceivable without sight.

---

## References

Component behavior is grounded in current conversational-UI guidance — responsive feedback / typing
indicators, brief natural-language replies, capability transparency, no dead ends, honest recovery
states, and accessible high-contrast bubbles with large tap targets:

- [Nine UX best practices for AI chatbots — Mind the Product](https://www.mindtheproduct.com/deep-dive-ux-best-practices-for-ai-chatbots/)
- [Chatbot UI Design Patterns and Best Practices — Fuselab Creative](https://fuselabcreative.com/chatbot-interface-design-guide/)
- [10 Best Practices for Conversational UI Design — Onething Design](https://www.onething.design/post/best-practices-for-conversational-ui-design)
- [Chatbot UI/UX Design Best Practices and Examples — Lollypop](https://lollypop.design/blog/2025/january/chatbot-ui-ux-design-best-practices-examples/)
