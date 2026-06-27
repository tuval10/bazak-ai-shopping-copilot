# Screens — Bazak AI Shopping Copilot

The top-level screens of the app. This file is the source of truth for *what screens exist and what
each one is for*; the reusable pieces inside them live in [COMPONENTS.md](COMPONENTS.md).

Scope is the conversational copilot described in [USER_STORIES.md](../USER_STORIES.md). UX choices
below follow established conversational-UI best practice: a clear single purpose per screen, visible
conversation history, persistent context, no dead ends, and honest recovery states (see *References*).

There are two screens:

1. **Conversations List** — pick up a past chat or start a new one.
2. **Conversation** — the chat itself, where discovery happens.

---

## 1. Conversations List

**Purpose:** let the user resume a previous conversation or start a fresh one, without scrolling
through everything. Backs **US-3.2, US-3.3, US-3.4**.

### What's on it

- **New conversation** action — always visible, the primary call to action. Starts a clean chat so a
  new topic isn't tangled with an old one (US-3.2).
- **Conversation list** — each row shows enough context to recognize the chat (US-3.3): a title
  (derived from the first request, e.g. *"wireless headphones under $100"*), a short preview of the
  last message, and a relative timestamp (e.g. "2h ago").
- **Search field** — filters the list by text that appeared in the chat or in the title (US-3.4).
  Clearing it restores the full list.
- **Selecting a row** opens that conversation and restores its full prior state (US-3.3), navigating
  to the Conversation screen.

### States

| State | What the user sees |
|-------|--------------------|
| **Has conversations** | The list, newest first, with the search field above it. |
| **Empty (first run)** | A friendly empty state explaining what the copilot does and a prominent *Start a conversation* button — never a blank screen. |
| **Search · no matches** | A clear "No conversations match '<query>'" message with a way back to the full list (US-3.4) — see [No Results Found](COMPONENTS.md#no-results-found). |
| **Loading list** | Lightweight skeleton rows while saved conversations load. |
| **Storage error** | If saved state is corrupt or unreadable, a non-destructive message lets the user start fresh instead of crashing (US-5.2). |

### Notes

- Conversations persist across refreshes and reopening the page (US-3.1), so this list is populated
  from local persistence, not just session memory.
- This screen may be presented as a sidebar alongside the Conversation on wide screens, and as a
  separate full screen on narrow/mobile widths — the responsibilities are identical either way.

---

## 2. Conversation

**Purpose:** the core experience — the user describes what they want in plain language and discovers
products through chat. Backs **Epic 1, Epic 2, Epic 4** and most of the product's value.

### What's on it

- **Header** — the conversation title and a way back to the [Conversations List](#1-conversations-list),
  plus a *New conversation* affordance so the user is never trapped in one thread (no dead ends).
- **Message transcript** — the scrollable history of the exchange, oldest at top, newest at bottom,
  auto-scrolling to the latest turn. Made up of:
  - [User Message](COMPONENTS.md#user-message) bubbles for what the user sent.
  - [Bot Message](COMPONENTS.md#bot-message) bubbles for the copilot's replies (summary + guidance).
  - [Product Catalog](COMPONENTS.md#product-catalog) blocks rendering results as cards inside the
    chat flow (US-2.1), grouped per intent for multi-intent messages (US-1.3).
  - [No Results Found](COMPONENTS.md#no-results-found) when a valid query matches nothing (US-4.4).
  - [Loading / Thinking](COMPONENTS.md#loading--bot-thinking) indicator while the bot works.
- **Composer** — the text input pinned at the bottom with a send action. Accepts free-form natural
  language (US-1.1); supports follow-ups and refinements like "show me cheaper" or "the second one"
  (US-4.5).
- **"Show more" affordance** — when more matches exist than were shown, the bot offers to load the
  next page of the *same* query rather than silently truncating (US-1.4).

### States

| State | What the user sees |
|-------|--------------------|
| **Empty / new chat** | A short welcome from the copilot and example prompts to lower the blank-page barrier ("Try: 'a phone under $500'"). |
| **Awaiting reply** | The user's message is shown immediately, followed by the [Loading / Thinking](COMPONENTS.md#loading--bot-thinking) indicator. |
| **Results returned** | Bot summary + a [Product Catalog](COMPONENTS.md#product-catalog) of cards, with availability and deal info (US-1.7). |
| **No results** | An honest [No Results Found](COMPONENTS.md#no-results-found) message that names the relaxed constraint and shows nearest alternatives (US-4.4). |
| **Off-catalog / chit-chat** | A [Bot Message](COMPONENTS.md#bot-message) that declines or replies briefly, then redirects to shopping (US-4.2, US-4.3). |
| **Error / failure** | A friendly fallback message with a suggested next step — never a crash or stack trace (US-5.2). |
| **End of results** | A clear "no more results" note when the last page is reached (US-1.4). |

### Notes

- Everything renders *inside the conversation flow* — products, errors, and clarifications are turns
  in the chat, not separate pages. This keeps context continuous (US-4.5) and the mental model simple.
- Grounding is a hard rule: only real catalog products ever appear here (US-5.1).

---

## References

UX direction above is grounded in current conversational-UI guidance — clear single purpose, visible
history and context memory, no dead ends / always-available escape hatches, brief natural-language
replies, honest recovery states, and accessible high-contrast bubbles with large tap targets:

- [Nine UX best practices for AI chatbots — Mind the Product](https://www.mindtheproduct.com/deep-dive-ux-best-practices-for-ai-chatbots/)
- [Chatbot UI Design Patterns and Best Practices — Fuselab Creative](https://fuselabcreative.com/chatbot-interface-design-guide/)
- [10 Best Practices for Conversational UI Design — Onething Design](https://www.onething.design/post/best-practices-for-conversational-ui-design)
- [UX Design Best Practices for Conversational AI and Chatbots — NeuronUX](https://www.neuronux.com/post/ux-design-for-conversational-ai-and-chatbots)
