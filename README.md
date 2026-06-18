# Demitri Refund Agent

An AI customer-support agent that **processes or denies e-commerce refunds** by reasoning over a CRM and a strict refund policy with **Claude tool-calling** — fronted by a clean customer **chat + voice** interface and an **admin dashboard that streams the agent's reasoning in real time**.

> Built for the "AI Customer Support Agent" challenge. The agent doesn't just answer — it looks up the order, validates it against ~12 numbered policy rules using tools, then **holds the line** on violations, escalates the edge cases, and recovers from gateway/API failures with visible retries.

- 🎥 **Loom walkthrough:** _<add your Loom link here>_

---

## What it does

- **Customer login + account scoping** — customers sign in before chatting, and the agent is **scoped to the authenticated account**. Every tool only sees that customer's orders, so no one can refund (or even read) another customer's order just by naming its number.
- **Chat + voice** customer interface — type or talk to "Aria," the refund agent. Speech-to-text uses the browser's Web Speech API (no key); replies can be read back via **ElevenLabs** (optional) or the browser voice.
- **Tool-calling agent loop** (raw Claude function-calling, not a framework) that dynamically calls policy-validation tools and decides: **approve / deny / escalate / request info**.
- **Policy enforced in code, not just the prompt** — `process_refund` re-validates every rule server-side and refuses ineligible refunds even if a customer tries to talk the model into one.
- **Live admin dashboard** — every session's reasoning, tool calls, tool results, **retries**, and decisions stream to a timeline, with running metrics (approved / denied / escalated / tool calls / retries).
- **Real failure/retry traces** — a simulated flaky payment gateway makes the first refund attempt fail so you can _see_ the agent recover; the model API call is wrapped in its own retry-with-backoff.

---

## Architecture

```
┌─ Web (React + Vite + Tailwind) ───────────────────────────────────────────────
│   Customer Chat + 🎙 Voice          Admin Dashboard
│   streams its own turn over SSE     live SSE feed of every session + metrics
└───────────────┬──────────────────────────────┬───────────────────────────────
    POST /api/chat/stream (SSE)         GET /api/admin/stream (SSE)
                ▼                              ▼
┌─ Server (Node + Express) ─────────────────────────────────────────────────────
│   agent/runAgentTurn.ts    the tool-calling loop — emits AgentEvents
│     ├─ agent/streaming.ts    streamed model call + API retry/backoff
│     └─ agent/tools/          definitions · executor · refundAssessment
│   events/                  eventBus → sessionStore → metrics
│   policy/                  pure, unit-tested rules     crm/store.ts   payments/
│   http/routes/             chat · admin · meta · voice       llm/anthropic.ts
└───────────────────────────────────────────────────────────────────────────────
                                ▼
                  Anthropic API · claude-opus-4-8
                  adaptive thinking · streaming · tool use
```

**Why these pieces:**

- **Raw tool-calling loop** gives full control over streaming, retries, and the event trace — exactly what the admin panel needs.
- **Policy lives in `policy/rules.ts`** (pure functions, unit-tested) so enforcement is deterministic and auditable. The LLM orchestrates; the rules decide.
- **One event type** (`AgentEvent` in `shared/`) is the contract between server and UI, so the dashboard is a faithful, type-safe mirror of the agent's thought process.

---

## Tech stack

| Layer    | Choice                                                                                 |
| -------- | -------------------------------------------------------------------------------------- |
| Agent    | `@anthropic-ai/sdk`, `claude-opus-4-8`, adaptive thinking, streaming, manual tool loop |
| Server   | Node 20+, TypeScript, Express, Server-Sent Events                                      |
| Web      | React 18, Vite, Tailwind CSS v4                                                        |
| Voice    | Web Speech API (STT) · ElevenLabs **or** browser `speechSynthesis` (TTS)               |
| Tests    | `node:test` via `tsx` (policy engine)                                                  |
| Monorepo | npm workspaces (`shared`, `server`, `web`)                                             |

---

## Quick start

### 1. Prerequisites

- **Node.js 20+** and npm.
- An **Anthropic API key** — created at <https://console.anthropic.com/settings/keys>. (This is a _platform API key_, separate from any Claude.ai / Claude Code subscription.)
- _(optional)_ an **ElevenLabs API key** for premium voice — <https://elevenlabs.io>. Without it, voice falls back to the browser's built-in speech.

### 2. Install

```bash
npm install
```

### 3. Configure

```bash
cp .env.example .env
# then edit .env and set ANTHROPIC_API_KEY=sk-ant-...
```

### 4. Run (dev — two servers, hot reload)

```bash
npm run dev
```

- Web UI → **http://localhost:5173**
- API → http://localhost:8787 (the web dev server proxies `/api` to it)

### 5. Or run as one process (after a build)

```bash
npm run build      # builds the web app into web/dist
npm start          # server serves the API AND the built UI on http://localhost:8787
```

> The server **boots without an API key** so you can browse the dashboard, CRM, and policy — the agent itself just returns a clear "set your key" error until you add one.

---

## Using it

**Log in first.** A login card sits over the chat box. The **"demo accounts"** list shows every test customer with the scenario it demonstrates — click one to fill the email, then sign in. **The password for every account is `password`.** Once you're in, just describe what you want to return — the agent already knows who you are and which orders are yours (you don't need to give an order number). Then flip to the **Admin Dashboard** (no login — it's the internal support view) to watch the reasoning stream in.

### Built-in scenarios (sign in as the account, then chat)

| Sign in as…                | Then say something like…                          | Outcome                                                                         | Rule    |
| -------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------- | ------- |
| `alice.nguyen@example.com` | "I'd like to return my speaker"                   | ✅ **Approved** (full refund)                                                   | R1, R11 |
| `bob.martinez@example.com` | "Refund my skillet"                               | ⛔ **Denied** — delivered 45 days ago                                           | R1      |
| `carol.smith@example.com`  | "Refund my gift card"                             | ⛔ **Denied** — final sale                                                      | R3      |
| `david.okafor@example.com` | "My laptop arrived defective"                     | ⤴ **Request photo, then escalate** — defective >$100 **and** order >$500        | R8 + R9 |
| `frank.li@example.com`     | "Return my opened headphones"                     | ✅ **Approved with 15% restocking fee** — _and recovers from a gateway failure_ | R5/R6   |
| `eve.thompson@example.com` | "Refund my rain jacket"                           | ⤴ **Escalated** — over the refund-abuse threshold                               | R10     |
| `jack.wilson@example.com`  | "Refund my coffee beans"                          | ⛔ **Denied** — perishable / >50% used                                          | R3/R7   |
| `grace.park@example.com`   | "Refund my photo software" / "...my audio plugin" | ⛔ Denied if accessed / ✅ Approved if not                                      | R4      |
| `henry.adams@example.com`  | "Refund my backpack"                              | ↩ **Offer cancellation** — not delivered yet                                    | R2      |
| `ivy.robinson@example.com` | "Refund my serum"                                 | ⛔ **Denied** — already refunded                                                | R2      |

**Try the security boundary:** sign in as **Alice** and ask to refund **order O1002** (that's Bob's order). The agent can't find it on your account and refuses — naming someone else's order number gets you nowhere.

All 15 customers (and the multi-order accounts) are visible in **Admin → CRM data**. The full policy is in **Admin → Refund policy** (and [`data/refund-policy.md`](data/refund-policy.md)).

### Voice

- Click 🎙 to speak your request (Chrome/Edge — Web Speech API).
- Toggle 🔊 to have Aria's replies read aloud. With `ELEVENLABS_API_KEY` set you get ElevenLabs; otherwise the browser voice.

### Seeing failures & retries (the "reasoning logs" deliverable)

`FLAKY_GATEWAY=true` (default) makes the **first** charge attempt for any order fail with a transient 503. Run the **opened-headphones (O1006)** approval and watch the Admin timeline show `tool_retry` → backoff → success. The model API call has its own `api_retry` path for 429/529/5xx. **Reset demo** (top-right) re-arms the flaky gateway so you can replay it.

---

## How the agent works

1. **Identify** — the customer is already authenticated; `get_my_account` pulls up their profile and orders. The agent only ever sees this one account.
2. **Verify with tools** — `check_return_window` (R1/R2), `check_item_eligibility` (R3–R8), `check_customer_standing` (R10), `calculate_refund_amount` (R6/R9). The system prompt tells Aria _never_ to trust the customer's word on dates/condition/eligibility — only the CRM + policy engine.
3. **Act** — `process_refund`, `deny_refund`, `escalate_to_human`, or `request_photo_evidence`.
4. **Explain** — Aria replies in plain language, citing the rule numbers.

**Server-side guardrails:** (1) every tool is **scoped to the authenticated customer** — order lookups go through an ownership check, so the agent (even under prompt injection) can't read or act on another customer's order. (2) `process_refund` recomputes the amount from policy (never trusting a model-supplied figure) and re-checks _every_ blocking rule; if a refund is ineligible it **refuses and returns the recommended action** (deny / escalate / request photo) — so social-engineering can't force an unjust refund.

---

## Tests

```bash
npm test     # 29 unit tests (policy engine + auth/account-scoping), no API key required
```

These verify the deterministic rules (window, final-sale, digital, condition, restocking fee, consumables, photo, high-value, abuse threshold) against the real date-anchored CRM.

```bash
npm run typecheck   # strict TS across server + web
```

---

## Project structure

The codebase is organised by responsibility — each module does one thing.

```
fm-project/
├─ data/
│  ├─ crm.json                 15 customer profiles (date-anchored to "today")
│  └─ refund-policy.md         the strict, numbered policy (R1–R12)
├─ shared/src/                 server ↔ web contract
│  ├─ domain.ts                CRM model (Customer, Order, OrderItem)
│  ├─ events.ts                the AgentEvent union (+ Emit)
│  └─ api.ts                   HTTP DTOs (Metrics, SessionSummary, AppConfig)
├─ server/src/
│  ├─ index.ts                 bootstrap (createApp + listen)
│  ├─ app.ts                   Express factory — mounts the route modules
│  ├─ config.ts                the single place that reads process.env
│  ├─ http/
│  │  ├─ sse.ts                Server-Sent-Events helpers
│  │  └─ routes/               chat · admin · meta (config/crm/policy) · voice
│  ├─ agent/
│  │  ├─ runAgentTurn.ts       the tool-calling loop (orchestration)
│  │  ├─ streaming.ts          streamed model call + API retry/backoff
│  │  ├─ systemPrompt.ts       persona + verification discipline
│  │  └─ tools/                definitions · executor · refundAssessment · types
│  ├─ policy/                  the deterministic policy engine
│  │  ├─ rules.ts              R1–R10 validators   · rules.test.ts (23 tests)
│  │  ├─ refund.ts             R6/R11 amount math  · constants.ts · policyDocument.ts
│  ├─ auth/                    login + bearer tokens   · auth.test.ts (6 tests)
│  ├─ crm/                     CRM repository — one async interface, two backends
│  │  ├─ store.ts              JSON (in-memory) + Postgres backends · account scoping
│  │  ├─ postgres.ts           live per-request queries + transactional refund write
│  │  ├─ anchor.ts             date anchoring shared by both backends
│  │  └─ seedPostgres.ts       one-off: seed Postgres from crm.json (raw dates)
│  ├─ payments/gateway.ts      simulated (flaky) payment gateway
│  ├─ events/                  sessionStore · eventBus · metrics
│  ├─ http/routes/             auth · chat · admin · meta · voice
│  ├─ llm/anthropic.ts         Claude client + retry/error helpers
│  ├─ voice/tts.ts             optional ElevenLabs TTS
│  └─ utils/                   dates (UTC day math) · ids (tickets/confirmations)
├─ web/src/
│  ├─ hooks/                   useChat · useAdminData · useAuth
│  ├─ components/chat/         ChatPanel · LoginOverlay · MessageBubble · Composer · …
│  ├─ components/admin/        AdminDashboard · MetricsBar · SessionList · Timeline · …
│  └─ lib/                     api (SSE + auth) · voice · format · scenarios · ids
└─ docs/DEMO_SCRIPT.md         the 7–10 min Loom walkthrough script
```

---

## Configuration (`.env`)

| Variable              | Default           | Notes                                                                |
| --------------------- | ----------------- | -------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`   | —                 | **required** for the agent                                           |
| `AGENT_MODEL`         | `claude-opus-4-8` | best reasoning for "holding the line"; `claude-sonnet-4-6` is faster |
| `AGENT_EFFORT`        | `medium`          | `low \| medium \| high \| max` — raise for max rigor                 |
| `FLAKY_GATEWAY`       | `true`            | first refund attempt per order fails (to demo retries)               |
| `ELEVENLABS_API_KEY`  | —                 | optional; enables ElevenLabs TTS                                     |
| `ELEVENLABS_VOICE_ID` | Rachel            | any ElevenLabs voice ID                                              |
| `PORT`                | `8787`            | API port                                                             |
| `CRM_BACKEND`         | `json`            | `json` (in-memory demo data) or `postgres` (live per-request reads)  |
| `DATABASE_URL`        | —                 | Postgres connection string; **required** when `CRM_BACKEND=postgres` |
| `PG_CA_BUNDLE`        | —                 | path to a CA bundle (e.g. the AWS RDS root CA) for *verified* TLS     |
| `PG_TLS_INSECURE`     | `false`           | `true` encrypts but skips Postgres TLS cert verification (demo only)  |

---

## Design notes

- **Pluggable CRM backend**: the agent's tools talk to an async repository (`crm/store.ts`) backed by either in-memory JSON (default, zero-infra) or live Postgres (`CRM_BACKEND=postgres`). In Postgres mode every tool call — lookup, ownership check, refund — runs a scoped query against the live database, and refunds are written back **transactionally and idempotently** (an already-refunded order is a no-op, so a retry can't double-refund). Switching backends needs no code changes.
- **Dates are anchored**: `crm.json` carries an `_anchorDate`; both backends shift every date onto today *at read time* so "delivered 10 days ago" stays 10 days ago whenever you run it — the scenarios never go stale. (Postgres stores the raw anchor-relative dates and re-anchors on read, so the same evergreen behavior holds without re-seeding daily.)
- **Thinking is streamed** (`display: "summarized"`) so the admin timeline shows Aria's actual reasoning, not just the final answer.
- **One coherent event model** powers both the customer "activity" strip and the admin timeline — they're two views of the same `AgentEvent` stream.

---

## Postgres backend (optional)

By default the app runs entirely in-memory (`CRM_BACKEND=json`) — no database needed. To run the agent against a live Postgres (e.g. AWS RDS):

```bash
# 1. create the schema (psql against your database)
psql "$DATABASE_URL" -f db/schema.sql

# 2. seed it from data/crm.json  (stores RAW anchor-relative dates)
CRM_BACKEND=postgres DATABASE_URL=postgresql://… npm -w server run seed:postgres

# 3. run with the Postgres backend
CRM_BACKEND=postgres DATABASE_URL=postgresql://… npm run dev
```

- **Live reads**: each agent tool call queries Postgres for just the relevant customer + orders, then re-anchors the demo dates onto today — so the database is the system of record, not a boot-time snapshot.
- **TLS** follows libpq `sslmode` semantics: `require` encrypts without verifying the chain (a normal RDS URL connects out of the box); `verify-full` + `PG_CA_BUNDLE` (the AWS RDS root CA) is the production-correct verified path; `PG_TLS_INSECURE=true` is an explicit escape hatch for a throwaway demo. Unit tests always run on the in-memory backend, so they never need a database.
- **Re-seeding** is only needed once after first creating the schema (or to reset the demo); because dates are stored raw and anchored on read, you don't re-seed as time passes.
