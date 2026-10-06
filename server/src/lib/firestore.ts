/**
 * Firestore access. Collections (all top-level, every document tagged with workspace_id):
 *
 *   workspaces  { owner_id, name, created_at }
 *   documents   { workspace_id, owner_id, filename, content_hash, status, chunk_count, shared_with[], ... }
 *   chunks      { workspace_id, document_id, chunk_index, section, content, embedding<vector 768> }
 *               ← THE single shared vector store for every workspace
 *   messages    { workspace_id, user_id, role, content, status, seq, reply_to, citations, retrieval, metrics }
 *   tasks       { workspace_id, title, notes, due_date, status, message_id }
 *   tool_calls  { workspace_id, message_id, tool_name, arguments(json), result(json), status, latency_ms }
 */
import type { Query } from 'firebase-admin/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import './firebase'; // ensures the Firebase app is initialised first

export const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

export const col = {
  workspaces: db.collection('workspaces'),
  documents: db.collection('documents'),
  chunks: db.collection('chunks'),
  messages: db.collection('messages'),
  tasks: db.collection('tasks'),
  toolCalls: db.collection('tool_calls'),
};

export const nowIso = () => new Date().toISOString();

let lastSeq = 0;
/** Monotonic ordering key for chat messages (single API instance). */
export function nextSeq(): number {
  lastSeq = Math.max(Date.now(), lastSeq + 1);
  return lastSeq;
}

/** Delete every document matched by a query, in batches. */
export async function deleteWhere(query: Query, batchSize = 300): Promise<number> {
  let deleted = 0;
  while (true) {
    const snap = await query.limit(batchSize).get();
    if (snap.empty) return deleted;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
  }
}

/** Snapshot → plain API object ({ id, ...fields }). */
export function toApi<T = Record<string, unknown>>(snap: FirebaseFirestore.DocumentSnapshot): T & { id: string } {
  return { id: snap.id, ...(snap.data() as T) };
}

export function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
