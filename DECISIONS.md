# Architecture Decisions — Bazak AI Shopping Copilot

A running log of architectural decisions, why they were made, and the alternatives rejected.
Lightweight ADR style. See [USER_STORIES.md](USER_STORIES.md) for scope and [FUTURE.md](FUTURE.md)
for deferred work. All entries: **Status — Accepted (2026-06-24).**

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
no server-side *session* coupling beyond loading a conversation by id.

**Alternatives rejected:**
- *Client-owned persistence* (localStorage/IndexedDB, stateless server) — viable, but the user chose
  a server-owned store so transcripts aren't tied to one browser and failure modes are centralized.

---

## D4 — Conversation storage format: append-only JSONL, one file per conversation

**Decision:** Each conversation is a single append-only `.jsonl` file; every turn/event is one line
(with a `version` tag). Reads replay the file; writes are `open(O_APPEND); write()`. Conversation
list = directory scan; search (US-3.4) = scan/replay files into an in-memory filter/index.

**Why (this workload is natively an immutable event log, not relational state):**
1. **Crash-safe appends with zero machinery.** Appending a line is about as atomic as filesystem ops
   get; a torn final line after a crash is just discarded and the rest stays intact — no WAL/journal
   coordination needed.
2. **No write-contention to manage.** Single-user, one append per turn means there's effectively no
   concurrency — so SQLite's write-lock layer (`SQLITE_BUSY`, "database is locked") would be
   machinery for a problem we don't have. One-file-per-conversation keeps it that way if turns ever
   overlap.
3. **Schema-free fits a heterogeneous payload.** A turn is a deeply nested, irregular blob (text,
   tool calls, tool results of varied shapes, usage stats, new fields over time). The per-line
   `version` tag handles format drift far more cheaply than `ALTER TABLE` migrations.
4. **Transparent, inspectable storage (dev-time).** JSONL is greppable, `jq`-able, and diff-able, so
   debugging and eval (US-6.1 reads the turn log) are "look at the file" — no DB client or SQL. A
   development convenience; end users never see the store.
5. **Append-only structurally enforces immutability.** The data model never mutates past events; a
   file you only append to resists `UPDATE`/`DELETE`, so the medium enforces the model's intent.
6. **No migration burden.** Old and new line versions coexist in one file; no schema migration to run
   against existing data.

**Failure handling (US-5.2):** torn last line on crash → discard it; malformed lines → skip and
continue; disk full / write error → fail the turn gracefully without corrupting prior history.

**Alternatives rejected:**
- *SQLite* — also crash-safe, but buys indexed queries, partial mutation, and referential integrity
  that this append-heavy, immutable workload barely uses, at the cost of locking, migrations,
  opacity, and a query layer. You'd likely store JSON in a TEXT column anyway.
- *JSON file rewritten in place* — whole-file rewrites risk partial-write corruption and aren't
  append-atomic.
- *In-memory + periodic snapshot* — loses recent turns on crash; weakest persistence guarantee.

**Accepted trade-off:** cross-conversation search (US-3.4) has no built-in index, so it's an
in-memory scan over files. That's fine at local single-user scale — indexing-for-search is an
occasional, derivable, offline concern, while crash-safe appends must be bulletproof every turn. If
search ever needs to scale, build a derived index on top of the JSONL (the log stays the source of
truth).

**Principle:** *Use a database for queries, mutation, and concurrency over shared structured state;
use an append-only log for durable, ordered, immutable events.* A conversation transcript is the
second.

---

## D5 — Client conversation pointer: URL route `/c/{id}`

**Decision:** The active conversation id lives in the URL (`/c/{id}`). Refresh reloads the route and
re-fetches from the server (US-3.1).

**Why:** No extra browser state to manage; bonus back/forward navigation and shareable/bookmarkable
conversations.

**Alternatives rejected:**
- *localStorage pointer* — works, but no shareable URLs and one more piece of browser state.

---

## D6 — Structured response payload; client renders product arrays

**Decision:** The server returns structured JSON: an assistant `message` plus a `results` array where
each entry is one intent with its own `products` array. Multi-intent → multiple arrays; single intent
→ one. The client renders each entry as a product-card group.

```jsonc
{
  "message": "Here's what I found…",
  "results": [
    { "intent": "phone under $500", "products": [ {…}, {…} ] },
    { "intent": "laptop bag",       "products": [ {…} ] }
  ]
}
```

**Why:** Clean separation — the server shapes data, the client owns presentation (US-2.1); multi-intent
(US-1.3) falls out naturally as multiple arrays. Grounding (US-5.1) is enforced server-side: the
generator only ever emits products actually returned by the catalog.
