import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { col, nowIso } from '../lib/firestore';
import { ingestDocument } from '../services/ingestion';

const SAMPLE_DIR = path.resolve(__dirname, '../../sample-docs');

const DEMO_WORKSPACES = [
  { folder: 'workspace-a', name: 'Acme Corp (Workspace A)' },
  { folder: 'workspace-b', name: 'Home & Garden (Workspace B)' },
];

/**
 * POST /api/demo/seed — creates two demo workspaces for the signed-in user and ingests the sample
 * documents into each. Safe to call repeatedly: workspaces are matched by name and ingestion is idempotent.
 */
export const demoRouter = Router();

demoRouter.post('/seed', async (req, res) => {
  const uid = req.user!.uid;
  const mine = await col.workspaces.where('owner_id', '==', uid).get();
  const created = [];
  for (const demo of DEMO_WORKSPACES) {
    const found = mine.docs.find((d) => d.get('name') === demo.name);
    const workspace = found
      ? { id: found.id, name: demo.name }
      : { id: (await col.workspaces.add({ owner_id: uid, name: demo.name, created_at: nowIso() })).id, name: demo.name };

    const dir = path.join(SAMPLE_DIR, demo.folder);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
    const documents = [];
    for (const filename of files) {
      const { document, duplicate } = await ingestDocument({
        workspaceId: workspace.id,
        ownerId: uid,
        filename,
        mimeType: 'text/markdown',
        buffer: fs.readFileSync(path.join(dir, filename)),
      });
      documents.push({ filename, duplicate, chunks: document.chunk_count });
    }
    created.push({ workspace, documents });
  }
  res.status(201).json({ workspaces: created });
});
