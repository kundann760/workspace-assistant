# 📚 Multi-Workspace Document Assistant (RAG + Tool Calling)

A full-stack web app where signed-in users organise documents into **workspaces**, chat with an AI assistant that answers
**only from the active workspace's documents (with citations)**, and lets the model **call tools** (save tasks, list tasks,
search again, notify a Slack/Discord channel), while every workspace's chunks share **one vector collection** and stay isolated.

**Stack:** React + TypeScript (Vite) · Node.js + TypeScript (Express 5) · **Firebase** (Authentication + Firestore with
vector search) · **Google Gemini** (chat + embeddings, free tier). No other services.

> 👉 **New here? Follow [SETUP_GUIDE.md](SETUP_GUIDE.md).** It walks you through Firebase, the Gemini key, installing,
> running locally and testing, step by step.

---

## Features

**Core**
- Firebase sign-in (email/password + Google); the API verifies the Firebase ID token on every request.
- Multiple workspaces per user with a switcher; uploads, chat, tasks and logs are all scoped to the active workspace.
- **One shared vector store**: a single Firestore `chunks` collection with a `workspace_id` field. The workspace filter is a
  **pre-filter inside the vector query** (`where(...).findNearest(...)`, backed by a composite vector index).
- Ingestion of PDF / Markdown / TXT / CSV / JSON: structure-aware chunking, Gemini embeddings, stored with workspace tag.
  **Idempotent:** document and chunk ids are derived from the content hash, so re-uploading never duplicates chunks.
- Grounded chat with numbered citations (`[1]`) mapped to document › section, and an honest
  *"I don't know based on the documents in this workspace."*
- Tool calling with 4 tools (`search_documents`, `save_task`, `list_tasks`, `send_notification`). Every call is
  schema-validated (zod, strict), executed by the server, logged, and fed back to the model.
- Dashboard: documents, chat history, tasks, tool-call log, observability, workspace switcher.

**Stretch goals implemented**
- 🔍 **Retrieval-debug view** on every answer: query workspace id, each chunk's workspace, similarity, vector rank, keyword rank, fused score.
- 🔀 **Hybrid re-ranking**: vector candidates are re-ranked with an IDF-weighted keyword score and fused with Reciprocal Rank Fusion.
- ⚡ **Token streaming** via Server-Sent Events.
- 🔁 **Multi-step tool use**: the model can call `search_documents`, read results, then call `save_task`, etc. (up to 5 steps).
- 🤝 **Opt-in cross-workspace sharing** of a single document, without weakening default isolation.
- 📈 **Observability**: per-request latency, time-to-first-token, prompt/completion tokens, retrieval hit/miss, tool success/error/rejected history.

---

## Architecture

```
┌────────────────────────── Browser (React + Vite) ──────────────────────────┐
│ Firebase Auth SDK → ID token                                               │
│ Dashboard: Workspace switcher · Chat (SSE stream) · Documents · Tasks ·    │
│            Tool calls · Observability · Retrieval debug                    │
└───────────────┬────────────────────────────────────────────────────────────┘
                │  Authorization: Bearer <Firebase ID token>
┌───────────────▼──────────────────── API (Node + Express) ──────────────────┐
│ requireAuth (firebase-admin verifyIdToken) → loadWorkspace (owner check)    │
│                                                                             │
│ Upload → extract → chunk → embed (Gemini) → write chunks {workspace_id,…}   │
│                                                                             │
│ Chat:  save question ─► embed question ─►                                   │
│        chunks.where(workspace_id == active).findNearest(embedding)          │
│        ─► keyword re-rank ─► Gemini stream ⇄ tool loop                      │
│        ─► save answer + citations + retrieval debug + metrics               │
└───────────────┬───────────────────────────────┬────────────────────────────┘
                │ Admin SDK (service account)   │
     ┌──────────▼──────────┐          ┌─────────▼─────────┐
     │ Cloud Firestore     │          │ Gemini API         │   (+ optional Slack/Discord webhook)
     │ ONE chunks coll.    │          │ chat + embeddings  │
     │ + vector indexes    │          └────────────────────┘
     └─────────────────────┘
```

### Firestore data model
| Collection | Key fields |
|------------|-----------|
| `workspaces` | `owner_id`, `name` |
| `documents` | `workspace_id`, `filename`, `content_hash`, `status`, `chunk_count`, `shared_with[]` |
| **`chunks`** | `workspace_id`, `document_id`, `chunk_index`, `section`, `content`, `embedding` (vector, 768) |
| `messages` | `workspace_id`, `role`, `content`, `status`, `seq`, `reply_to`, `citations`, `retrieval`, `metrics` |
| `tasks` | `workspace_id`, `title`, `notes`, `due_date`, `status` |
| `tool_calls` | `workspace_id`, `message_id`, `tool_name`, `arguments`, `result`, `status`, `latency_ms` |

Composite vector indexes (in `firestore.indexes.json`): `chunks (workspace_id ASC, embedding VECTOR<768>)` and
`chunks (document_id ASC, embedding VECTOR<768>)`. `firestore.rules` denies **all** direct client access; only the API
(Admin SDK) touches data.

### How workspace isolation is enforced
1. **Ownership:** every `/api/workspaces/:id/...` route first loads the workspace and checks `owner_id == <uid>`
   (404 otherwise), so a user can't even name another user's workspace.
2. **Inside the vector query:** `server/src/services/retrieval.ts` runs
   `chunks.where('workspace_id', '==', activeWorkspace).findNearest(...)`. Firestore applies the equality pre-filter
   **inside** the nearest-neighbour search (that's why the composite vector index exists). Chunks from other workspaces are
   never candidates, so they can't be ranked, sent to the LLM, cited, or used by a tool. Documents explicitly shared into the
   workspace get their own `where('document_id', '==', sharedDocId).findNearest(...)` query; nothing else does.
3. **Tools never take a workspace id from the model.** The workspace comes from the authenticated request context; schemas
   are `.strict()`, so an injected `workspace_id` argument makes the call fail validation.
4. **No client database access:** security rules deny all reads/writes from browsers.
5. **Proof:** the retrieval-debug panel and the e2e test (`npm run test:e2e`, against the Firestore emulator) check that a
   question asked in workspace B retrieves zero workspace-A chunks and that no A text reaches the LLM.

### Retrieval design
- **Chunking:** Markdown is split by heading path (`Plan › Timeline`), PDFs by page; paragraphs are packed into ~1000-char
  chunks with ~150-char overlap; long paragraphs split on sentences. The filename + section is prepended when embedding.
- **Embeddings:** `gemini-embedding-001` at 768 dimensions (`RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY` task types), re-normalised.
- **Vector search:** cosine distance via Firestore `findNearest`, top 25 candidates (workspace-filtered).
- **Hybrid re-rank:** Firestore has no full-text search, so the candidates are re-ranked with an IDF-weighted keyword-overlap
  score and fused with the vector ranking using Reciprocal Rank Fusion (`1/(60+rank)`). This rescues exact identifiers
  (codes, names, numbers) that embeddings blur. Because it only re-orders already-filtered candidates, it can never widen
  what a workspace sees.
- **Similarity floor:** candidates with no keyword match and similarity below `RAG_MIN_SIMILARITY` (0.45) are dropped. With no
  evidence, the model is told so and answers "I don't know".

### Tool-calling loop (`server/src/services/chat.ts`)
```
for step in 0..MAX_TOOL_STEPS:
    stream Gemini (tools = AUTO, or NONE on the final step to force an answer)
    forward text tokens to the browser
    if no functionCall parts → done
    append model turn verbatim (keeps thoughtSignature)
    for each call: known tool? → zod-validate args → execute with server-side context → log → functionResponse
    append responses, continue
```
Unknown tools and malformed arguments are **rejected without executing**. The model receives a structured error and the
attempt is logged as `rejected` in the Tool calls tab.

### Prompt-injection defences
- Retrieved text is wrapped in `<source id=… document=…>` tags; any `</source>`/`<source` inside a document is escaped.
- The system prompt states that source text is untrusted data and that only the user's chat message can request actions.
- Hard limits live in code, not in the prompt: allow-listed tools only, strict schemas, no destructive tools, workspace from
  context, Discord `allowed_mentions` disabled (no `@everyone`), message length caps.
- The demo includes `vendor-notes-INJECTION-TEST.md`, which tries to make the assistant call `delete_everything` and leak the
  launch code. Ask about it and watch the Tool calls tab stay clean.

### Reliability
- The question is **saved before** any LLM call. The assistant message starts as `pending`. On failure it becomes `error`
  with a **Retry** button that reuses the same question (no duplicates).
- If the browser disconnects mid-answer, the server keeps going and saves the answer.
- Gemini calls retry with exponential backoff on 429/5xx/timeouts. Streams abort if idle for 60 s.
- Ingestion is idempotent: document id = hash(workspace + content), chunk id = `<docId>_<index>`, claimed in a Firestore
  transaction, chunks replaced (never appended) on retry. Failed ingestions are marked `failed` and re-processed next upload.
- Secrets live only in `server/.env` and the git-ignored service-account file. Logs never include document text, request
  bodies, keys, private keys or webhook URLs (a scrubber redacts them if they appear in error messages).

---

## Project structure

```
workspace-assistant/
├── README.md                 ← you are here
├── SETUP_GUIDE.md            ← step-by-step setup (Firebase, Gemini, install, run, test, deploy)
├── AI_NOTES.md               ← notes on how AI was used (template to complete)
├── CLAUDE.md                 ← context file for AI coding assistants
├── package.json              ← root helper scripts (setup / dev / build / test)
├── firebase.json             ← Firebase CLI config (rules, indexes, emulator)
├── firestore.indexes.json    ← composite VECTOR indexes for the chunks collection
├── firestore.rules           ← deny all direct client access
├── render.yaml               ← optional Render blueprint for the API
│
├── server/                   ← Node.js + TypeScript API
│   ├── .env.example
│   ├── sample-docs/          ← demo documents for Workspace A and B (incl. injection test)
│   ├── src/
│   │   ├── index.ts          ← starts server (checks Firestore connectivity first)
│   │   ├── app.ts            ← Express app, middleware & route wiring
│   │   ├── config.ts         ← validated environment variables
│   │   ├── lib/              ← firebase-admin, firestore helpers, gemini client, logger, errors
│   │   ├── middleware/       ← auth (token + workspace ownership), error handler
│   │   ├── routes/           ← workspaces, documents, chat (SSE), activity (tasks/tools/metrics), demo seed
│   │   └── services/         ← extract, chunker, ingestion, retrieval, tools, chat orchestration
│   └── test/                 ← vitest unit tests + e2e.cjs (Firestore emulator + mock Gemini)
│
└── client/                   ← React + TypeScript (Vite)
    ├── .env.example
    ├── public/_redirects, vercel.json   ← SPA routing for static hosts
    └── src/
        ├── firebase.ts, api.ts, types.ts
        ├── context/AuthContext.tsx
        ├── pages/LoginPage.tsx, DashboardPage.tsx
        └── components/       ← WorkspaceSwitcher, ChatPanel, RetrievalDebugView, DocumentsPanel,
                                 TasksPanel, ToolLogPanel, MetricsPanel
```

---

## Quick start

```bash
npm run setup                     # install root, server and client dependencies
# Firebase: create Firestore DB, save server/service-account.json, deploy indexes (SETUP_GUIDE.md Steps 3–4)
# create server/.env and client/.env from the .env.example files
npm run dev                       # API on :8080, web app on :5173
```

| Command | What it does |
|---------|--------------|
| `npm run setup` | Installs all dependencies (root + server + client) |
| `npm run dev` | Runs API (`tsx watch`) + web app (Vite) together |
| `npm run build` | Compiles the API to `server/dist` and the web app to `client/dist` |
| `npm test` | Server unit tests (no keys needed) |
| `npm run test:e2e` | Full API end-to-end test against the local Firestore emulator and a mock Gemini (needs Java, no keys) |
| `npx -y firebase-tools@latest deploy --only firestore --project <id>` | Deploy vector indexes + security rules |

---

## Environment variables

### `server/.env` (secrets, never commit)
| Variable | Required | Description |
|----------|----------|-------------|
| `FIREBASE_PROJECT_ID` | ✅ | Firebase project ID |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | ✅ (local) | Path to the service-account JSON, default `./service-account.json` |
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | ✅ (hosting) | Same JSON, base64-encoded on one line (use instead of the path on Render etc.) |
| `GEMINI_API_KEY` | ✅ | Google AI Studio key |
| `PORT` | | API port (default `8080`) |
| `CORS_ORIGINS` | | Comma-separated allowed browser origins (default `http://localhost:5173`) |
| `GEMINI_CHAT_MODEL` | | Default `gemini-2.5-flash` |
| `GEMINI_EMBEDDING_MODEL` | | Default `gemini-embedding-001` (must support 768-dim output) |
| `NOTIFY_WEBHOOK_URL` | | Slack or Discord incoming-webhook URL for `send_notification` |
| `RAG_TOP_K` / `RAG_CANDIDATES` / `RAG_MIN_SIMILARITY` | | Retrieval tuning (6 / 25 / 0.45) |
| `MAX_TOOL_STEPS` | | Max tool rounds per question (default 5) |

### `client/.env` (public, safe to ship to browsers)
| Variable | Description |
|----------|-------------|
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` | Firebase web-app config |
| `VITE_API_URL` | Empty for local dev (Vite proxies `/api`). In production: your API's URL |

---

## API reference (all routes need `Authorization: Bearer <Firebase ID token>` except `/api/health`)

| Method & path | Purpose |
|---------------|---------|
| `GET /api/health` | Liveness check |
| `GET /api/me` | Current user |
| `POST /api/demo/seed` | Create 2 demo workspaces with sample docs (idempotent) |
| `GET/POST /api/workspaces` | List / create workspaces |
| `PATCH/DELETE /api/workspaces/:id` | Rename / delete (removes all its data and shares) |
| `GET/POST /api/workspaces/:id/documents` | List (own + shared-in) / upload (`multipart`, field `files`, ≤5 × 10 MB) |
| `DELETE /api/workspaces/:id/documents/:docId` | Delete document + its chunks |
| `POST /api/workspaces/:id/documents/:docId/shares` | Share into another of your workspaces `{ targetWorkspaceId }` |
| `DELETE /api/workspaces/:id/documents/:docId/shares/:targetId` | Stop sharing |
| `GET/DELETE /api/workspaces/:id/messages` | Chat history (with tool calls, citations, debug, metrics) / clear |
| `POST /api/workspaces/:id/chat` | Ask `{ message }` or retry `{ retryOfMessageId }` → **SSE**: `start`, `retrieval`, `token`, `tool`, `done` / `error` |
| `GET /api/workspaces/:id/tasks` · `PATCH/DELETE …/tasks/:taskId` | Tasks |
| `GET /api/workspaces/:id/tool-calls` | Tool-call log |
| `GET /api/workspaces/:id/metrics` | Observability aggregates |

---

## Testing for reviewers

1. Sign up with any email (or use a throwaway account created in Firebase → Authentication → Users → Add user).
2. Click **✨ Load demo workspaces**.
3. Use the question table in [SETUP_GUIDE.md → Step 10](SETUP_GUIDE.md#step-10-sign-in-and-try-the-app). The key isolation
   test: ask *"What is the launch code word for Project Falcon?"* in **Workspace A** (answer: BLUE-PELICAN-42) and then in
   **Workspace B** ("I don't know"; retrieval debug shows only B chunks).

## Deployment

See [SETUP_GUIDE.md → Deployment notes](SETUP_GUIDE.md#deployment-notes-for-later-you-host-it-yourself). In short:
API on Render (root `server`, set `FIREBASE_SERVICE_ACCOUNT_BASE64` instead of the key file), web app on any static host
(root `client`, build `npm run build`, output `dist`, set `VITE_API_URL`), then add the frontend domain to Firebase
*Authorized domains* and to the API's `CORS_ORIGINS`.

## Known limitations / next steps
- Ingestion runs inside the upload request. Very large PDFs on a free host could hit request timeouts; a job queue would fix that.
- Keyword matching re-ranks the top vector candidates only (Firestore has no full-text index); a dedicated search index would add true keyword recall.
- Workspace-scoped lists (messages, tasks, tool calls) are read in full and sorted in memory to avoid extra composite indexes; fine for demo-scale data, paginate for large workspaces.
- Scanned (image-only) PDFs aren't OCR'd. One chat thread per workspace. In-memory rate limiting.
