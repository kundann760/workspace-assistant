import crypto from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { col, db, deleteWhere, nowIso } from '../lib/firestore';
import { embedTexts } from '../lib/gemini';
import { logger } from '../lib/logger';
import { chunkBlocks } from './chunker';
import { extractDocument } from './extract';

export interface DocumentRow {
  id: string;
  workspace_id: string;
  owner_id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number;
  content_hash: string;
  chunk_count: number;
  status: 'processing' | 'ready' | 'failed';
  error: string | null;
  shared_with: string[];
  created_at: string;
  updated_at: string;
}

export interface IngestResult {
  document: DocumentRow;
  /** True when identical content already existed in this workspace (nothing re-inserted). */
  duplicate: boolean;
}

/** A 'processing' document older than this is assumed to belong to a crashed request and may be retried. */
const STALE_PROCESSING_MS = 5 * 60_000;
const WRITE_BATCH = 100;

/**
 * Ingest one file into a workspace. Idempotent: the Firestore document id is derived from
 * (workspace id, sha256 of the normalised text), and chunk ids from (document id, chunk index).
 * Re-uploading the same content, even under another filename, never creates duplicate chunks.
 */
export async function ingestDocument(input: {
  workspaceId: string;
  ownerId: string;
  filename: string;
  mimeType?: string;
  buffer: Buffer;
}): Promise<IngestResult> {
  const { blocks, normalizedText } = await extractDocument(input.buffer, input.filename);
  const contentHash = crypto.createHash('sha256').update(normalizedText).digest('hex');
  const docId = crypto.createHash('sha256').update(`${input.workspaceId}:${contentHash}`).digest('hex').slice(0, 32);
  const ref = col.documents.doc(docId);

  // Claim the document atomically so two concurrent uploads can't both ingest it.
  const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = nowIso();
    if (!snap.exists) {
      const fresh: Omit<DocumentRow, 'id'> = {
        workspace_id: input.workspaceId,
        owner_id: input.ownerId,
        filename: input.filename,
        mime_type: input.mimeType ?? null,
        size_bytes: input.buffer.length,
        content_hash: contentHash,
        chunk_count: 0,
        status: 'processing',
        error: null,
        shared_with: [],
        created_at: now,
        updated_at: now,
      };
      tx.create(ref, fresh);
      return { claimed: true, doc: { id: docId, ...fresh } };
    }
    const existing = { id: docId, ...(snap.data() as Omit<DocumentRow, 'id'>) };
    const stale = Date.now() - new Date(existing.updated_at).getTime() > STALE_PROCESSING_MS;
    if (existing.status === 'ready' || (existing.status === 'processing' && !stale)) {
      return { claimed: false, doc: existing };
    }
    // A previous attempt failed (or crashed): take it over and re-process.
    tx.update(ref, { status: 'processing', error: null, filename: input.filename, updated_at: now });
    return { claimed: true, doc: { ...existing, status: 'processing' as const, filename: input.filename } };
  });

  if (!claim.claimed) return { document: claim.doc, duplicate: true };

  try {
    const chunks = chunkBlocks(blocks);
    // Prefix filename + section so each embedding carries its document context.
    const embeddings = await embedTexts(
      chunks.map((c) => `${input.filename}${c.section ? ` — ${c.section}` : ''}\n\n${c.content}`),
      'RETRIEVAL_DOCUMENT',
    );

    // Replace (never append): clear chunks from any earlier attempt, then write deterministic ids.
    await deleteWhere(col.chunks.where('document_id', '==', docId));
    for (let i = 0; i < chunks.length; i += WRITE_BATCH) {
      const batch = db.batch();
      chunks.slice(i, i + WRITE_BATCH).forEach((chunk, j) => {
        batch.set(col.chunks.doc(`${docId}_${chunk.index}`), {
          workspace_id: input.workspaceId,
          document_id: docId,
          filename: input.filename,
          chunk_index: chunk.index,
          section: chunk.section,
          content: chunk.content,
          embedding: FieldValue.vector(embeddings[i + j]),
          created_at: nowIso(),
        });
      });
      await batch.commit();
    }

    const updated_at = nowIso();
    await ref.update({ status: 'ready', chunk_count: chunks.length, error: null, updated_at });
    logger.info(`Ingested document ${docId} (${chunks.length} chunks) into workspace ${input.workspaceId}`);
    return { document: { ...claim.doc, status: 'ready', chunk_count: chunks.length, error: null, updated_at }, duplicate: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ingestion failed';
    await ref.update({ status: 'failed', error: message.slice(0, 500), updated_at: nowIso() }).catch(() => undefined);
    logger.error(`Ingestion failed for document ${docId}`, err);
    throw err;
  }
}
