/**
 * Minimal Gemini REST client (Google AI Studio, free tier).
 * We call the REST API directly with fetch so the request shape is explicit and
 * the API key only ever travels in a header — never in a URL that could be logged.
 */
import { config } from '../config';
import { logger } from './logger';

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface FunctionCall {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
}

export interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: FunctionCall;
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  /** Omit for tools without arguments (Gemini rejects an OBJECT with no properties). */
  parameters?: Record<string, unknown>;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface StreamChunk {
  parts: GeminiPart[];
  usage?: Usage;
  finishReason?: string;
  blockReason?: string;
}

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function geminiFetch(path: string, body: unknown): Promise<Response> {
  let lastError: LlmError | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${config.GEMINI_BASE_URL}/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': config.GEMINI_API_KEY,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (res.ok) {
        // The timeout covers connecting + headers; streaming bodies manage their own lifetime.
        clearTimeout(timer);
        return res;
      }
      const detail = await res.text().catch(() => '');
      const retryable = res.status === 429 || res.status >= 500;
      lastError = new LlmError(
        `Gemini API error ${res.status}: ${extractErrorMessage(detail)}`,
        res.status,
        retryable,
      );
      if (!retryable) throw lastError;
    } catch (err) {
      if (err instanceof LlmError && !err.retryable) throw err;
      lastError =
        err instanceof LlmError
          ? err
          : new LlmError(
              (err as Error).name === 'AbortError' ? 'Gemini request timed out' : `Network error calling Gemini: ${(err as Error).message}`,
              undefined,
              true,
            );
    } finally {
      clearTimeout(timer);
    }
    if (attempt < MAX_ATTEMPTS) {
      const delay = 800 * 2 ** (attempt - 1) + Math.random() * 300;
      logger.warn(`Gemini call failed (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${Math.round(delay)}ms`, lastError?.message);
      await sleep(delay);
    }
  }
  throw lastError ?? new LlmError('Gemini request failed');
}

function extractErrorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body);
    return parsed?.error?.message ?? body.slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

function normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export type EmbeddingTask = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

/** Embed many texts (batched, 100 per request). Returns unit-length vectors. */
export async function embedTexts(texts: string[], taskType: EmbeddingTask): Promise<number[][]> {
  const model = `models/${config.GEMINI_EMBEDDING_MODEL}`;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const res = await geminiFetch(`${model}:batchEmbedContents`, {
      requests: batch.map((text) => ({
        model,
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: config.embeddingDimensions,
      })),
    });
    const json = (await res.json()) as { embeddings?: { values: number[] }[] };
    if (!json.embeddings || json.embeddings.length !== batch.length) {
      throw new LlmError('Embedding response did not contain the expected number of vectors');
    }
    for (const e of json.embeddings) {
      if (e.values.length !== config.embeddingDimensions) {
        throw new LlmError(`Expected ${config.embeddingDimensions}-dim embeddings, got ${e.values.length}`);
      }
      // Truncated (Matryoshka) gemini embeddings must be re-normalised for cosine similarity.
      out.push(normalize(e.values));
    }
  }
  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [vec] = await embedTexts([text], 'RETRIEVAL_QUERY');
  return vec;
}

export interface GenerateRequest {
  systemInstruction: string;
  contents: GeminiContent[];
  tools?: FunctionDeclaration[];
  /** AUTO lets the model pick; NONE forbids tool calls (used to force a final answer). */
  toolMode?: 'AUTO' | 'NONE';
}

/** Stream a generateContent call as Server-Sent Events, yielding each partial response. */
export async function* streamGenerate(req: GenerateRequest): AsyncGenerator<StreamChunk> {
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: req.systemInstruction }] },
    contents: req.contents,
    generationConfig: { temperature: 0.2 },
  };
  if (req.tools?.length) {
    body.tools = [{ functionDeclarations: req.tools }];
    body.toolConfig = { functionCallingConfig: { mode: req.toolMode ?? 'AUTO' } };
  }

  const res = await geminiFetch(`models/${config.GEMINI_CHAT_MODEL}:streamGenerateContent?alt=sse`, body);
  if (!res.body) throw new LlmError('Gemini returned an empty stream');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // Abort if the stream goes silent for too long.
  const idleTimeoutMs = REQUEST_TIMEOUT_MS;

  while (true) {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new LlmError('Gemini stream stalled', undefined, true)), idleTimeoutMs);
    });
    let result: ReadableStreamReadResult<Uint8Array>;
    try {
      result = await Promise.race([reader.read(), timeout]);
    } catch (err) {
      reader.cancel().catch(() => undefined);
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (result.done) break;
    buffer += decoder.decode(result.value, { stream: true }).replace(/\r\n/g, '\n');

    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      yield parseChunk(payload);
    }
  }
  const rest = buffer.trim();
  if (rest.startsWith('data:')) yield parseChunk(rest.slice(5).trim());
}

function parseChunk(payload: string): StreamChunk {
  let json: any;
  try {
    json = JSON.parse(payload);
  } catch {
    throw new LlmError('Could not parse Gemini stream chunk');
  }
  if (json.error) throw new LlmError(`Gemini stream error: ${json.error.message ?? 'unknown'}`, json.error.code);
  const candidate = json.candidates?.[0];
  const usage = json.usageMetadata
    ? {
        promptTokens: json.usageMetadata.promptTokenCount ?? 0,
        completionTokens: (json.usageMetadata.candidatesTokenCount ?? 0) + (json.usageMetadata.thoughtsTokenCount ?? 0),
        totalTokens: json.usageMetadata.totalTokenCount ?? 0,
      }
    : undefined;
  return {
    parts: (candidate?.content?.parts as GeminiPart[]) ?? [],
    usage,
    finishReason: candidate?.finishReason,
    blockReason: json.promptFeedback?.blockReason,
  };
}
