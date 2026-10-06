import { config } from './config';
import { createApp } from './app';
import { logger } from './lib/logger';
import { db } from './lib/firestore';

async function main() {
  // Fail fast with a clear message if Firestore isn't reachable / the credentials are wrong.
  try {
    await db.collection('workspaces').limit(1).get();
  } catch (err) {
    logger.error(
      'Cannot reach Firestore. Check that the Firestore database exists (Firebase console → Build → Firestore Database) ' +
        'and that FIREBASE_PROJECT_ID / the service-account file are correct.',
      err,
    );
    process.exit(1);
  }
  logger.info(`Connected to Firestore (project ${config.FIREBASE_PROJECT_ID}${config.FIRESTORE_EMULATOR_HOST ? ', emulator' : ''})`);

  const app = createApp();
  const server = app.listen(config.PORT, () => {
    logger.info(`API listening on http://localhost:${config.PORT}`);
  });

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});
