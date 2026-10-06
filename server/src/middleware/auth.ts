import type { NextFunction, Request, Response } from 'express';
import { col } from '../lib/firestore';
import { firebaseAuth } from '../lib/firebase';
import { HttpError, notFound } from '../lib/errors';

export interface AuthUser {
  uid: string;
  email: string | null;
}

export interface Workspace {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      workspace?: Workspace;
    }
  }
}

/** Verifies the Firebase ID token sent as `Authorization: Bearer <token>`. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return next(new HttpError(401, 'Missing sign-in token'));

  try {
    const decoded = await firebaseAuth.verifyIdToken(token);
    req.user = { uid: decoded.uid, email: decoded.email ?? null };
    next();
  } catch {
    next(new HttpError(401, 'Invalid or expired sign-in token'));
  }
}

/** Firestore auto-ids (20 chars) and our own hex ids; rejects anything that could be a path. */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
export const isId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);

/** Loads :workspaceId and checks the signed-in user owns it. 404 (not 403) to avoid leaking existence. */
export async function loadWorkspace(req: Request, _res: Response, next: NextFunction) {
  const workspaceId = req.params.workspaceId;
  if (!isId(workspaceId)) return next(notFound('Workspace'));
  const snap = await col.workspaces.doc(workspaceId).get();
  if (!snap.exists || snap.get('owner_id') !== req.user!.uid) return next(notFound('Workspace'));
  req.workspace = { id: snap.id, ...(snap.data() as Omit<Workspace, 'id'>) };
  next();
}
