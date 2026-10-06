import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { col, db, deleteWhere, nowIso } from '../lib/firestore';
import { badRequest } from '../lib/errors';

const MAX_WORKSPACES = 20;
const nameSchema = z.object({ name: z.string().trim().min(1, 'Name is required').max(80) });

/** /api/workspaces — list and create (no workspace scope yet). */
export const workspacesRouter = Router();

workspacesRouter.get('/', async (req, res) => {
  const snap = await col.workspaces.where('owner_id', '==', req.user!.uid).get();
  const workspaces = await Promise.all(
    snap.docs.map(async (d) => {
      const count = await col.documents.where('workspace_id', '==', d.id).count().get();
      return { id: d.id, name: d.get('name'), created_at: d.get('created_at'), document_count: count.data().count };
    }),
  );
  workspaces.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  res.json({ workspaces });
});

workspacesRouter.post('/', async (req, res) => {
  const { name } = nameSchema.parse(req.body);
  const existing = await col.workspaces.where('owner_id', '==', req.user!.uid).count().get();
  if (existing.data().count >= MAX_WORKSPACES) throw badRequest(`You can have at most ${MAX_WORKSPACES} workspaces.`);
  const workspace = { owner_id: req.user!.uid, name, created_at: nowIso() };
  const ref = await col.workspaces.add(workspace);
  res.status(201).json({ workspace: { id: ref.id, name, created_at: workspace.created_at, document_count: 0 } });
});

/** /api/workspaces/:workspaceId — rename and delete (workspace already loaded + ownership checked). */
export const workspaceRouter = Router();

workspaceRouter.patch('/', async (req, res) => {
  const { name } = nameSchema.parse(req.body);
  await col.workspaces.doc(req.workspace!.id).update({ name });
  res.json({ workspace: { id: req.workspace!.id, name, created_at: req.workspace!.created_at } });
});

workspaceRouter.delete('/', async (req, res) => {
  const ws = req.workspace!.id;
  // Delete everything tagged with this workspace (chunks first, so nothing is left retrievable).
  for (const collection of [col.chunks, col.documents, col.messages, col.tasks, col.toolCalls]) {
    await deleteWhere(collection.where('workspace_id', '==', ws));
  }
  // Remove this workspace from documents other workspaces had shared into it.
  const sharedIn = await col.documents.where('shared_with', 'array-contains', ws).get();
  if (!sharedIn.empty) {
    const batch = db.batch();
    sharedIn.docs.forEach((d) => batch.update(d.ref, { shared_with: FieldValue.arrayRemove(ws) }));
    await batch.commit();
  }
  await col.workspaces.doc(ws).delete();
  res.status(204).end();
});
