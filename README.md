# bazak-ai-shopping-copilot

AI shopping copilot for Bazak — a conversational interface that helps users discover products from
the DummyJSON catalog through natural-language chat.

## Project Documents

| Document | What's in it |
|----------|--------------|
| [assignment.MD](assignment.MD) | The original assignment brief — overview, requirements, deliverables, and the questions this README must ultimately answer. The source of truth for *what's being asked*. |
| [USER_STORIES.md](USER_STORIES.md) | What we're building and how it should behave — in-scope user stories grouped into epics, with acceptance criteria and a decision log for every edge case (ambiguous / off-catalog / chit-chat / multi-intent / no-results / follow-ups). The source of truth for *scope and intended behavior*. |
| [DECISIONS.md](DECISIONS.md) | Architecture decision log — topology, orchestration (Mastra), persistence (Mastra Memory / LibSQL), routing, and the response payload, each with rationale and rejected alternatives. The source of truth for *why it's built this way*. |
| [FUTURE.md](FUTURE.md) | Deliberately deferred scope (security/abuse controls, profile & personalization, analytics, performance budget, richer product views) — so the cuts are intentional rather than forgotten. |
| [UX/SCREENS.md](UX/SCREENS.md) | The two top-level screens (Conversations List, Conversation) — what each is for and the states it covers. The source of truth for *what screens exist*. |
| [UX/COMPONENTS.md](UX/COMPONENTS.md) | The five reusable building blocks (user message, bot message, product catalog, no-results, loading) — how each looks and behaves. The source of truth for *the pieces inside the screens*. |
| [UX/mocks/](UX/mocks/index.html) | High-fidelity static HTML mockups of the screens and components in all key states. Open [UX/mocks/index.html](UX/mocks/index.html) in a browser — no build step. |

> Setup/run instructions, architecture rationale, retrieval strategy, and evaluation details will be
> filled in here as the implementation lands.
