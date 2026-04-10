# NWG Atlas — Project Context

Internal AI chatbot for **New World Group** employees, named **Atlas**. Ask natural-language questions about client leads (MySQL) and GA4 traffic data. Claude answers by calling structured tools; no SQL is ever written or exposed to the user.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Styles | SCSS Modules |
| AI | Anthropic Claude API (`claude-opus-4-5` default, overridable) |
| Leads DB | MySQL / MariaDB — existing `newworld_connect` database |
| App DB | Neon serverless Postgres — conversations, messages, users, request_log |
| Analytics | Google Analytics 4 Data API (service account) |
| Auth | JWT in httpOnly cookie (`jose` + `bcryptjs`) |
| Hosting | Vercel |

---

## How the app works

1. User logs in at `/login` with username + password.
2. A JWT is signed and stored in a `nwg_session` httpOnly cookie (8 h expiry).
3. `proxy.ts` (Next.js 16's replacement for `middleware.ts`) guards every route — unauthenticated page requests redirect to `/login`, API requests return 401.
4. On the main page, the user types a question into the chat.
5. `POST /api/chat` receives the message, checks rate limits, runs an input guard, then calls Claude with the message history.
6. Claude decides which tool(s) to call. The server executes the tool, returns results to Claude, and Claude produces a final natural-language answer.
7. The conversation (user + assistant messages) is persisted to Neon so multi-turn context works across the session.

**Anthropic API key is only used for Claude calls.** MySQL queries, GA4 requests, and Neon reads/writes all run directly from the server using their own credentials — no Anthropic involvement. Each user message typically triggers 2 Claude API calls: one to decide which tool to use, one to turn the tool result into a natural-language answer.

---

## Claude tools

All tool definitions live in `lib/tools.ts`. Execution logic is in `lib/tool-executor.ts`.

| Tool | What it does |
|---|---|
| `list_clients` | Lists clients from the `lists` table ordered by most recently added — default 10, hard cap 25. Supports optional name/domain search filter. Always reports true total count. |
| `query_leads` | Lead / form submission counts from MySQL via `COUNT(*)` — always returns the real total, never capped |
| `get_recent_leads` | Returns individual lead records (name, email, phone, date, source, keywords, etc.) — default 10, hard cap 25 |
| `search_leads` | Finds leads matching a specific value in a specific field (email, phone, name, id, zip, source, keywords, etc.) — hard cap 25 |
| `query_analytics` | GA4 totals — sessions, active users, pageviews for a date range |
| `query_analytics_breakdown` | GA4 breakdowns — top pages by pageviews (`top_pages`) or top events by count (`top_events`) |

Claude is given today's date in the system prompt and resolves natural-language dates (e.g. "this week", "last month") to `YYYY-MM-DD` before calling tools.

---

## Token management

All limits are centralised in **`lib/limits.ts`** — change them in one place and they propagate everywhere.

```
MAX_RECORDS_RETURNED         = 25   # universal hard cap for any tool returning individual records
                                    # (get_recent_leads, search_leads, list_clients, and any future record tools)
MAX_BREAKDOWN_ROWS           = 25   # query_leads breakdown rows (source/medium/etc.)
MAX_ANALYTICS_BREAKDOWN_ROWS = 10   # top_pages / top_events rows
MAX_CONVERSATION_HISTORY     = 6    # past messages sent to Claude per request (3 pairs)
MAX_RESPONSE_TOKENS          = 1024 # Claude max output tokens per call
```

**One cap to rule them all:** `MAX_RECORDS_RETURNED` is the single constant used by every tool that returns a list of individual records. Adding a new record-type tool? Import `MAX_RECORDS_RETURNED` — do not create a new constant.

**Why conversation history is capped at 6:** Every message in a conversation is re-sent to Claude on every turn. For a data query tool, questions are mostly independent — 3 back-and-forth pairs is enough to handle natural follow-ups ("what about last month?", "break that down by source") without accumulating expensive context.

**Tool results and token cost:** When leads or analytics data is returned to Claude, that data is sent as input tokens. Large result sets = higher cost. The caps above bound the worst-case token usage per request.

**Claude knows when results are truncated.** For all record-returning tools, a separate `COUNT(*)` query runs in parallel with the records query. The tool result includes both `total_available`/`total_found` (real DB count) and `total_returned` (capped count), so Claude can tell the user "showing 25 of 40 results." Claude is also instructed via the system prompt to always communicate the true total and mention the cap.

`query_leads` always returns the real count via `COUNT(*)` — the cap never applies to count queries.

---

## MySQL database structure (`newworld_connect`)

- **`lists`** — client directory. Each row is one form/website. Columns exposed to the agent: `id`, `list_name`, `domain`, `analytics_id` (GA4 property ID, nullable), `password`, `required`, `notify_client_recipients`. Many other columns exist in the table but are not selected.
- **`list_{id}`** — one table per list entry, holds the actual lead rows. Schemas vary between tables — not all tables have all columns.

### Lead columns always selected (present in every table)
`id`, `name`, `email`, `phone`, `dt` (as `submitted_at`), `source`, `medium`, `campaign`

### Lead columns selected when present, NULL otherwise
`keywords`, `comments` *(truncated to 200 chars)*, `broker`, `price_range`, `property`, `home_type`, `how_did_you_hear`, `movein_date`

**Dynamic SELECT:** `buildLeadSelect(table)` in `tool-executor.ts` queries `INFORMATION_SCHEMA.COLUMNS` before each lead query to check which optional columns exist in that specific table. Missing columns are returned as `NULL` so the query never fails due to schema differences between tables.

### On-demand fields (never shown unless explicitly asked)
`comments`, `broker`, `price_range`, `property`, `home_type`, `how_did_you_hear`, `movein_date` — these are fetched but the system prompt instructs Claude to never include them in a response unless the user explicitly asks. `keywords` is shown normally.

### Search whitelist
Fields searchable via `search_leads`: `id`, `email`, `phone`, `name`, `zip`, `address`, `broker`, `source`, `medium`, `campaign`, `keywords`, `assigned`. Field names are validated against this whitelist before use in any query.

### Deduplication
All lead queries deduplicate by email address — if the same email submitted multiple times, it counts as 1 and only the most recent record is returned. Records with a NULL email are each treated as unique (no email to deduplicate on).

- **SQL level:** Uses a `MAX(id) ... GROUP BY IFNULL(LOWER(TRIM(email)), CAST(id AS CHAR))` subquery pattern applied to both COUNT and records queries in every lead tool. This ensures counts and returned records are always deduplicated before hitting the application layer.
- **Cross-list JS level:** For clients with multiple forms, results from each list are merged, sorted by date DESC, then deduplicated again in JavaScript before trimming to the cap. First occurrence of each email (most recent) wins.
- **Breakdown queries:** Deduplication is applied inside the subquery before grouping by source/medium/campaign/form_name, so breakdown counts reflect unique leads not raw submissions.

### Filtering
- `@newworldgroup.com` emails are always excluded from all lead queries to filter out internal submissions. Claude is instructed to note this on every lead response: *"Note: newworldgroup.com emails are always excluded from results."* Controlled via `SHOW_EMAIL_EXCLUSION_NOTE` env var (defaults to `true` if unset, set to `'false'` to suppress).
- Client lookup is always done with `LIKE` on `list_name` or `domain`, so partial names work.
- Phone search normalises both sides to digits only via `REGEXP_REPLACE` so any formatting in the DB matches any formatting the user types.

---

## Neon Postgres schema

```
users
  id            UUID PK
  username      VARCHAR(100) UNIQUE       # used for login, stored lowercase
  display_name  VARCHAR(100) nullable     # shown in the header UI
  password_hash VARCHAR(255)
  created_at    TIMESTAMPTZ
  last_login    TIMESTAMPTZ

conversations
  id            UUID PK
  created_at    TIMESTAMPTZ

messages
  id              UUID PK
  conversation_id UUID FK → conversations.id (CASCADE DELETE)
  role            VARCHAR(20)  CHECK IN ('user','assistant')
  content         TEXT
  created_at      TIMESTAMPTZ

request_log
  id            UUID PK
  user_id       UUID FK → users.id (nullable)  # no username stored — join to users if needed
  ip            VARCHAR(45)
  input_tokens  INT
  output_tokens INT
  created_at    TIMESTAMPTZ
```

**Note:** `username` is intentionally not stored in `request_log` — only `user_id`. Join to the `users` table if you need the username, so a username change never causes stale data.

---

## Security layers

1. **`proxy.ts`** — JWT check on every request before it reaches any route handler.
2. **`lib/guards.ts` — input guard** — `checkUserMessage()` blocks destructive SQL keywords in raw user input before it reaches Claude. `checkQueryValue()` blocks injection attempts in any value passed to a query.
3. **Claude system prompt** — Claude is instructed it is strictly read-only and must never discuss or attempt mutating operations.
4. **`lib/tool-executor.ts` — parameterised queries** — all MySQL queries use `pool.execute()` with `?` placeholders. Field names used in queries (e.g. `search_field`) are validated against a strict whitelist before use.
5. **MySQL user** — the `analyticsai` DB user has read-only privileges (`SELECT` only).

---

## Auth flow

- **`lib/auth.ts`** — `signToken`, `verifyToken`, cookie helpers. Session payload contains `{ userId, username, displayName }`.
- **`proxy.ts`** — reads the session via `getSessionFromRequest(req)` (Edge-compatible, reads the cookie directly from the `NextRequest`).
- **`app/api/auth/login/route.ts`** — bcrypt compare → sign JWT → set httpOnly cookie.
  - Uses a valid 60-character dummy bcrypt hash for timing-attack protection when no user row is found. The dummy hash must be exactly 60 chars in bcrypt format — a shorter/malformed hash causes `bcrypt.compare` to throw, which would 500 the route. The compare is also wrapped in try/catch as a second safety net.
- **`app/api/auth/logout/route.ts`** — clears the session cookie.
- The header shows `display_name` if set, falling back to `username`.

---

## Rate limiting

Implemented in `lib/rate-limit.ts` using the Neon `request_log` table.

- **Per-IP per hour** — default 10 (env: `RATE_LIMIT_PER_IP_PER_HOUR`)
- **Daily total across all users** — default 20 (env: `RATE_LIMIT_DAILY_TOTAL`)

`logRequest()` is called non-blocking (`.catch(console.error)`) after each successful chat response and records IP, user_id, and token counts. Token counts are used to estimate Claude API cost via `getUsageStats()`.

---

## GA4 integration

Service account JSON is stored as a single-line JSON string in `GOOGLE_SERVICE_ACCOUNT_JSON`. The `BetaAnalyticsDataClient` is instantiated on demand in `lib/ga4.ts`.

GA4 errors are classified into three types and surfaced to the user with actionable messages:
- `permission_denied` — service account not added to that GA4 property
- `unauthenticated` — bad/expired credentials
- `not_found` — property ID no longer exists

When GA4 fails, Claude always offers to pull lead data instead.

`getTopEvents` automatically filters out noisy auto-collected GA4 events (`session_start`, `first_visit`, `user_engagement`) so results show meaningful interactions only.

---

## Suggestion chips

The intro screen shows 6 dynamic question chips fetched from `GET /api/clients/recent`, which queries MySQL for the 6 most recently added unique client names (`GROUP BY list_name ORDER BY MAX(id) DESC LIMIT 6`). Each client gets a different question template (leads today, last 10 leads, traffic, leads this month, email search, leads by source). Hardcoded fallback names are shown instantly while the fetch resolves.

---

## File structure

```
app/
  page.tsx                  # Server component — reads session, passes displayName down
  HomeClient.tsx            # Client wrapper for Header + Chat
  globals.scss              # Global CSS variables (--accent, --surface, --border, etc.)
  layout.tsx
  login/
    page.tsx                # Login page (server)
    LoginForm.tsx           # Client form wrapped in <Suspense> (useSearchParams)
  api/
    auth/login/route.ts     # POST — bcrypt verify, sign JWT, set cookie
    auth/logout/route.ts    # POST — clear cookie
    chat/route.ts           # POST — main chat endpoint (rate limit → guard → Claude loop)
    clients/recent/route.ts # GET  — latest 6 client names from MySQL (for suggestion chips)
    conversations/route.ts  # GET  — list conversations
    usage/route.ts          # GET  — usage stats from request_log

components/
  Header/                   # Logo (nwg_icon.svg), "NWG Atlas" brand name, display name + logout
  Chat/                     # Textarea, send button, message list, suggestion chips
  Message/                  # Renders a single chat bubble (markdown via react-markdown + remark-gfm)
                            # Assistant avatar label: "Atlas"
  Suggestions/              # Intro screen with 6 dynamic question chips (fetched from /api/clients/recent)

lib/
  auth.ts                   # JWT sign/verify, cookie helpers, SessionPayload type
  ga4.ts                    # getTrafficData, getTopPages, getTopEvents
  guards.ts                 # checkUserMessage, checkQueryValue
  limits.ts                 # ALL app-wide caps and limits — single source of truth
  mysql.ts                  # Singleton mysql2 connection pool
  neon.ts                   # createConversation, saveMessage, getMessages
  neon-sql.ts               # Lazy singleton Neon client (avoids module-level instantiation)
  rate-limit.ts             # checkRateLimit, logRequest, getUsageStats
  tool-executor.ts          # executeListClients, executeLeadsQuery, executeRecentLeads,
                            #   executeLeadSearch, executeAnalyticsQuery, executeAnalyticsBreakdown
                            #   buildLeadSelect — dynamic SELECT helper for list_xxx tables
  tools.ts                  # Claude tool definitions (input_schema for all 6 tools)

scripts/
  init-db.mjs               # Creates/migrates all Neon tables — safe to re-run
  seed-user.mjs             # Creates/updates the default user from .env.local
  reset-data.mjs            # Truncates chat/log data, preserves specified user accounts
                            # Edit KEEP_USERNAMES array inside to control which users survive

proxy.ts                    # Next.js 16 middleware (named export 'proxy', not 'middleware')
types/index.ts              # All shared TypeScript types
public/nwg_icon.svg         # NWG logo (red SVG, used in header)
.env.local.example          # Template for all required environment variables
```

---

## Scripts

```bash
node scripts/init-db.mjs    # Run once (or after schema changes) — creates/migrates Neon tables
node scripts/seed-user.mjs  # Creates or updates the default user (reads DEFAULT_* from .env.local)
node scripts/reset-data.mjs # Wipes conversations/messages/request_log, keeps specified users
```

---

## Environment variables

See `.env.local.example` for the full template. Key variables:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key — only used for chat, not for DB or GA4 calls |
| `ANTHROPIC_MODEL` | Optional model override (default: `claude-opus-4-5`) |
| `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE` | Lead database connection |
| `DATABASE_URL` | Neon Postgres connection string |
| `JWT_SECRET` | Signs session tokens — generate with `openssl rand -base64 32` |
| `DEFAULT_USERNAME` | Seed script: login username (stored lowercased) |
| `DEFAULT_PASSWORD` | Seed script: login password |
| `DEFAULT_DISPLAY_NAME` | Seed script: name shown in the header (optional, falls back to username) |
| `RATE_LIMIT_PER_IP_PER_HOUR` | Default: 10 — also set in `lib/limits.ts` as fallback |
| `RATE_LIMIT_DAILY_TOTAL` | Default: 20 — also set in `lib/limits.ts` as fallback |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Full service account JSON as a single-line string |
| `SHOW_EMAIL_EXCLUSION_NOTE` | Set to `'false'` to suppress the newworldgroup.com exclusion note on lead results. Defaults to `true` if unset. |

---

## Next.js 16 notes

- Middleware must be exported as `proxy` (not `middleware`) from `proxy.ts` (not `middleware.ts`).
- `cookies()` is async — must be awaited.
- Client components using `useSearchParams` must be wrapped in `<Suspense>`.
- Neon client must not be instantiated at module level — use the lazy singleton in `lib/neon-sql.ts`.

---

## Known gotchas

- **Dummy bcrypt hash** — must be exactly 60 characters in valid bcrypt format. A shorter hash causes `bcrypt.compare` to throw (not return false), which 500s the login route. Current dummy: `$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234`
- **`username` not stored in `request_log`** — only `user_id` is stored. This was a deliberate decision so username changes don't cause stale data. Join to `users` table if you need the name.
- **GA4 `query_analytics_breakdown` limit** — the `limit` parameter in the tool caps at `MAX_ANALYTICS_BREAKDOWN_ROWS` (default 10). Claude uses this as the default if the user doesn't specify a number.
- **Conversation history window** — only the last `MAX_CONVERSATION_HISTORY` (6) messages are sent to Claude per request. Older messages in a conversation are saved to Neon but not included in the API call context.
- **Tool result token cost** — tool results (lead records, GA4 data) are sent back to Claude as input tokens. This is where most token usage comes from in complex queries, not the user's message itself.
- **`list_xxx` schema variance** — not all client tables have the same columns. Always use `buildLeadSelect(table)` when querying lead tables — it checks `INFORMATION_SCHEMA` and substitutes `NULL` for any missing optional column so queries never silently fail and return empty results.
- **newworldgroup.com exclusion** — internal emails are always filtered out of lead results at the query level. If a lead appears missing, check whether the submitter used a newworldgroup.com email before assuming a bug.
- **`comments` truncation** — comments are truncated to 200 characters at the SQL level (`LEFT(comments, 200)`) to prevent spam or large free-text fields from inflating tool result token payloads.
- **Lead deduplication** — all lead counts and records are deduplicated by email at the SQL level before returning. Null-email records are always treated as unique. If you see lower counts than raw `SELECT COUNT(*)` in phpMyAdmin, this is expected and correct behaviour.
