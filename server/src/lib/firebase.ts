import fs from 'node:fs';
import path from 'node:path';
import { cert, getApps, initializeApp, ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { config } from '../config';

function loadServiceAccount(): ServiceAccount | undefined {
  if (config.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    return JSON.parse(Buffer.from(config.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'));
  }
  if (config.FIREBASE_SERVICE_ACCOUNT_PATH) {
    const file = path.resolve(process.cwd(), config.FIREBASE_SERVICE_ACCOUNT_PATH);
    if (!fs.existsSync(file)) {
      throw new Error(`Service-account file not found at ${file}. Check FIREBASE_SERVICE_ACCOUNT_PATH in server/.env.`);
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return undefined; // emulator
}

if (!getApps().length) {
  const serviceAccount = loadServiceAccount();
  initializeApp({
    projectId: config.FIREBASE_PROJECT_ID,
    ...(serviceAccount ? { credential: cert(serviceAccount) } : {}),
  });
}

export const firebaseAuth = getAuth();
