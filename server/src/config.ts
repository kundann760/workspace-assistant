import 'dotenv/config';
import { z } from 'zod';

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  FIREBASE_PROJECT_ID: z.string().min(1, 'FIREBASE_PROJECT_ID is required'),
  /** Local dev: path to the service-account JSON file downloaded from Firebase. */
  FIREBASE_SERVICE_ACCOUNT_PATH: optionalString,
  /** Hosting: the same JSON file, base64-encoded into one line. */
  FIREBASE_SERVICE_ACCOUNT_BASE64: optionalString,
  /** Set automatically by the Firebase emulator tooling; no credentials needed then. */
  FIRESTORE_EMULATOR_HOST: optionalString,
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
  GEMINI_CHAT_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
  GEMINI_BASE_URL: z.string().url().default('https://generativelanguage.googleapis.com/v1beta'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  NOTIFY_WEBHOOK_URL: optionalString.pipe(z.string().url().optional()),
  RAG_TOP_K: z.coerce.number().int().min(1).max(20).default(6),
  RAG_CANDIDATES: z.coerce.number().int().min(5).max(100).default(25),
  RAG_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.45),
  MAX_TOOL_STEPS: z.coerce.number().int().min(1).max(10).default(5),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('\n❌ Invalid server configuration. Check your server/.env file:\n');
  for (const issue of parsed.error.issues) {
    console.error(`  • ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\nSee server/.env.example and SETUP_GUIDE.md.\n');
  process.exit(1);
}

const env = parsed.data;
if (!env.FIRESTORE_EMULATOR_HOST && !env.FIREBASE_SERVICE_ACCOUNT_PATH && !env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
  console.error(
    '\n❌ Firestore needs a service account. Set FIREBASE_SERVICE_ACCOUNT_PATH (local) or\n' +
      '   FIREBASE_SERVICE_ACCOUNT_BASE64 (hosting) in server/.env. See SETUP_GUIDE.md, Step 3.\n',
  );
  process.exit(1);
}

export const config = {
  ...env,
  isProduction: env.NODE_ENV === 'production',
  corsOrigins: env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
  /** Must match the dimension of the vector indexes in firestore.indexes.json. */
  embeddingDimensions: 768,
};
