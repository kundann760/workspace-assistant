import { FieldValue } from 'firebase-admin/firestore';
import { col, db, deleteWhere } from '../lib/firestore';

export interface ClearedCounts {
  chunks: number;
  documents: number;
  messages: number;
  tasks: number;
  tool_calls: number;
}

/**
 * Delete everything tagged with a workspace (documents, chunks, chat history, tasks, tool-call log /
 * observability data) and unlink documents other workspaces shared into it. The workspace itself stays.
 */
export async function clearWorkspaceData(ws: string): Promise<ClearedCounts> {
  // Chunks first, so nothing is left retrievable if a later step fails.
  const counts: ClearedCounts = {
    chunks: await deleteWhere(col.chunks.where('workspace_id', '==', ws)),
    documents: await deleteWhere(col.documents.where('workspace_id', '==', ws)),
    messages: await deleteWhere(col.messages.where('workspace_id', '==', ws)),
    tasks: await deleteWhere(col.tasks.where('workspace_id', '==', ws)),
    tool_calls: await deleteWhere(col.toolCalls.where('workspace_id', '==', ws)),
  };
  const sharedIn = await col.documents.where('shared_with', 'array-contains', ws).get();
  if (!sharedIn.empty) {
    const batch = db.batch();
    sharedIn.docs.forEach((d) => batch.update(d.ref, { shared_with: FieldValue.arrayRemove(ws) }));
    await batch.commit();
  }
  return counts;
}
