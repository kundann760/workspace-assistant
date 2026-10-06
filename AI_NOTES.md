# AI_NOTES.md

> ✏️ **Template, please personalise before submitting.** The assignment asks how *you* worked with AI. The facts
> below describe how the initial codebase was generated. Edit them, and add your own experience from running, debugging and
> deploying it. The "hardest bug" section is read most closely, so replace or extend it with a real problem you hit.

## Tools and models
- **Claude Code (Claude Opus 5.5)** generated the initial full-stack codebase, the tests and the docs from the assignment PDF,
  using `CLAUDE.md` as the persistent context file.
- *(Add anything else you used: Copilot, ChatGPT, Cursor, …)*

**Split of work:** *(describe yours, e.g. "AI wrote the first version of every file. I set up Firebase, deployed the
indexes, ran the isolation and injection tests by hand, and fixed X and Y.")*

## Key decisions (and why)
1. **Firestore as the single shared vector store.** I wanted the whole backend on Firebase + Gemini only. Firestore's
   `findNearest` supports an equality pre-filter that is applied *inside* the nearest-neighbour search when a composite
   vector index exists, so `where('workspace_id','==',ws).findNearest(...)` meets the "filter inside the vector query"
   requirement directly. All chunks live in one `chunks` collection.
2. **The model proposes, the server disposes.** Tools are an allow-list with strict zod schemas. The workspace id comes
   from the authenticated request, never from model arguments, and there are no destructive tools. Prompt instructions are
   defence in depth, not the boundary. Firestore rules deny all client access, so the API is the only door.
3. **Keyword re-ranking on top of vector search.** Firestore has no full-text search, so the vector candidates
   (already workspace-filtered) are re-ranked with an IDF-weighted keyword score and fused via RRF. That rescues exact
   identifiers like `BLUE-PELICAN-42` without being able to widen the isolation boundary.
4. **Deterministic ids for idempotency**: document id = hash(workspace + content), chunk id = `<docId>_<index>`, claimed in a
   transaction. Re-uploads are detected, and a retried ingestion overwrites rather than duplicates.

## Hardest bug / wrong turn
*(Replace with your own story if you have a better one.)*

**Token accounting over a stream.** The first draft of the streaming loop summed `usageMetadata` from every SSE chunk.
Gemini's usage numbers are *cumulative within one streamed call*, so that would have over-counted tokens on long
answers. Reviewing the loop caught it; the fix keeps only the last usage block per call and sums across tool-loop steps.

Related trap, avoided by design and covered by the e2e test: with Gemini 2.5 "thinking" models, the model's
function-call turn must be sent back **verbatim, including `thoughtSignature`**. Merging or rebuilding streamed parts can
drop it and break multi-step tool calls.

## What I'd improve with more time
- Move ingestion to a background job (e.g. Cloud Tasks) with progress updates for large PDFs.
- A real keyword index or an LLM/cross-encoder re-ranker, plus an offline eval set for retrieval quality.
- Paginated, indexed queries for very large workspaces; multiple conversations per workspace.
- Persistent rate limiting and per-workspace quotas; OCR for scanned PDFs.
