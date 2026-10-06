# CLAUDE.md: context for AI coding assistants

## What this project is
Multi-workspace RAG document assistant. React/TS client (`client/`), Node/TS Express 5 API (`server/`),
Firebase Auth (client SDK + firebase-admin token verification), **Cloud Firestore** (data + vector search via
`findNearest`), Gemini via REST. No other backing services.

## Non-negotiable invariants
1. **One shared vector collection** (`chunks`) for all workspaces. Never create per-workspace collections.
2. **Workspace filter inside the vector query**: always `chunks.where('workspace_id', '==', ws).findNearest(...)`
   (or `where('document_id', '==', sharedDocId)` for explicitly shared docs). Never filter retrieved chunks in JS after
   the fact as the isolation mechanism. Any new pre-filter field needs a composite vector index in `firestore.indexes.json`.
3. **Tools get the workspace from `ToolContext`**, never from model arguments. Tool schemas stay `.strict()`.
4. **Validate before execute**: every model tool call goes through `executeToolCall` (allow-list + zod) and is logged.
5. **Retrieved document text is data**: keep it wrapped in `<source>` tags and escaped via `escapeSourceText`.
6. **No secrets in the client or logs.** Gemini key / service account / webhook URL only on the server; use `logger` (it scrubs).
7. **Don't lose work**: persist the user question before calling the LLM; mark failures as `status='error'`.
8. **Idempotent ingestion**: document id = hash(workspace + content hash); chunk ids `<docId>_<index>`; replace, never append.
9. Clients never access Firestore directly (`firestore.rules` denies all); all access is through the Admin SDK in the API.

## Conventions
- Server is CommonJS output (`module: nodenext`, no `"type": "module"`): relative imports have no extension.
- Firestore fields are snake_case and API responses mirror them (the client's `types.ts` depends on that shape).
- Timestamps are ISO strings; chat ordering uses the numeric `seq` from `nextSeq()`.
- Workspace-scoped lists use single-field equality queries and sort in memory, to avoid extra composite indexes.
- Model-supplied data stored in Firestore (`tool_calls.arguments/result`) is JSON-stringified.
- Express 5: async handlers may throw; `HttpError` → status code; zod errors → 400.
- Embedding dimension is 768 in `config.embeddingDimensions` and in `firestore.indexes.json`; change both together.

## Commands
- `npm run dev` (root): API + client · `npm test`: unit tests · `npm run test:e2e`: API e2e on the Firestore emulator (needs Java)
- After changing server code, run `npm run typecheck --prefix server` and `npm run test:e2e`.
