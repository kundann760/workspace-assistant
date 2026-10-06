import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import multer from 'multer';
import { col, deleteWhere } from '../lib/firestore';
import { badRequest, HttpError, notFound } from '../lib/errors';
import { isId } from '../middleware/auth';
import { ingestDocument } from '../services/ingestion';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 5 } });

export const documentsRouter = Router();

/** Documents owned by this workspace + documents other workspaces have explicitly shared into it. */
documentsRouter.get('/', async (req, res) => {
  const ws = req.workspace!.id;
  const [owned, sharedIn, mine] = await Promise.all([
    col.documents.where('workspace_id', '==', ws).get(),
    col.documents.where('shared_with', 'array-contains', ws).get(),
    col.workspaces.where('owner_id', '==', req.user!.uid).get(),
  ]);
  const names = new Map(mine.docs.map((d) => [d.id, d.get('name') as string]));

  const documents = owned.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        filename: data.filename,
        mime_type: data.mime_type,
        size_bytes: data.size_bytes,
        chunk_count: data.chunk_count,
        status: data.status,
        error: data.error,
        created_at: data.created_at,
        shared_with: ((data.shared_with as string[]) ?? [])
          .filter((id) => names.has(id))
          .map((id) => ({ workspaceId: id, workspaceName: names.get(id) })),
      };
    })
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  const shared = sharedIn.docs.map((d) => ({
    id: d.id,
    filename: d.get('filename'),
    chunk_count: d.get('chunk_count'),
    status: d.get('status'),
    created_at: d.get('created_at'),
    source_workspace_id: d.get('workspace_id'),
    source_workspace_name: names.get(d.get('workspace_id')) ?? 'another workspace',
  }));
  res.json({ documents, sharedIn: shared });
});

documentsRouter.post('/', upload.array('files', 5), async (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) throw badRequest('Attach at least one file in the "files" field.');

  const results = [];
  // Sequential on purpose: keeps us well inside the free-tier embedding rate limits.
  for (const file of files) {
    // Multer decodes filenames as latin1; re-decode so non-ASCII names survive.
    const filename = Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 200);
    try {
      const { document, duplicate } = await ingestDocument({
        workspaceId: req.workspace!.id,
        ownerId: req.user!.uid,
        filename,
        mimeType: file.mimetype,
        buffer: file.buffer,
      });
      results.push({ filename, ok: true, duplicate, document });
    } catch (err) {
      const message = err instanceof HttpError ? err.message : `Could not ingest: ${(err as Error).message}`;
      results.push({ filename, ok: false, error: message });
    }
  }
  const anyOk = results.some((r) => r.ok);
  res.status(anyOk ? 201 : 400).json({ results });
});

async function loadOwnDocument(workspaceId: string, documentId: unknown) {
  if (!isId(documentId)) throw notFound('Document');
  const snap = await col.documents.doc(documentId).get();
  if (!snap.exists || snap.get('workspace_id') !== workspaceId) throw notFound('Document');
  return snap;
}

documentsRouter.delete('/:documentId', async (req, res) => {
  const snap = await loadOwnDocument(req.workspace!.id, req.params.documentId);
  await deleteWhere(col.chunks.where('document_id', '==', snap.id));
  await snap.ref.delete();
  res.status(204).end();
});

/** Opt-in sharing: make one document of this workspace retrievable from another workspace you own. */
documentsRouter.post('/:documentId/shares', async (req, res) => {
  const target = req.body?.targetWorkspaceId;
  const snap = await loadOwnDocument(req.workspace!.id, req.params.documentId);
  if (!isId(target)) throw badRequest('targetWorkspaceId must be a workspace id');
  if (target === req.workspace!.id) throw badRequest('A document is already available in its own workspace.');

  const targetWs = await col.workspaces.doc(target).get();
  if (!targetWs.exists || targetWs.get('owner_id') !== req.user!.uid) throw notFound('Target workspace');

  await snap.ref.update({ shared_with: FieldValue.arrayUnion(target) });
  res.status(201).json({ ok: true });
});

documentsRouter.delete('/:documentId/shares/:targetWorkspaceId', async (req, res) => {
  const snap = await loadOwnDocument(req.workspace!.id, req.params.documentId);
  await snap.ref.update({ shared_with: FieldValue.arrayRemove(req.params.targetWorkspaceId) });
  res.status(204).end();
});
