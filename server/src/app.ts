import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config';
import { loadWorkspace, requireAuth } from './middleware/auth';
import { errorHandler } from './middleware/error';
import { activityRouter } from './routes/activity';
import { chatRouter } from './routes/chat';
import { demoRouter } from './routes/demo';
import { documentsRouter } from './routes/documents';
import { workspaceRouter, workspacesRouter } from './routes/workspaces';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind Render/Railway/etc. load balancers
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
      allowedHeaders: ['Authorization', 'Content-Type'],
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Everything below requires a valid Firebase sign-in.
  app.use('/api', requireAuth);
  app.get('/api/me', (req, res) => {
    res.json({ user: req.user });
  });
  app.use('/api/demo', demoRouter);
  app.use('/api/workspaces', workspacesRouter);

  // Everything below is scoped to one workspace the user owns.
  const scoped = express.Router({ mergeParams: true });
  scoped.use(workspaceRouter);
  scoped.use('/documents', documentsRouter);
  scoped.use(chatRouter);
  scoped.use(activityRouter);
  app.use('/api/workspaces/:workspaceId', loadWorkspace, scoped);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  app.use(errorHandler);
  return app;
}
