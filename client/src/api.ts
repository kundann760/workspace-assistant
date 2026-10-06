import { auth } from './firebase';
import type { ChatMessage, RetrievalDebug, ToolCallSummary } from './types';

const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new ApiError('Not signed in', 401);
  return { Authorization: `Bearer ${await user.getIdToken()}` };
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(await authHeader()), ...(init.headers as Record<string, string>) };
  if (init.body && !(init.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, { ...init, headers });
  } catch {
    throw new ApiError('Cannot reach the server. Is the API running?', 0);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !(res.status === 400 && data?.results)) {
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

export type ChatStreamEvent =
  | { type: 'start'; userMessageId: string; assistantMessageId: string }
  | { type: 'retrieval'; retrieval: RetrievalDebug }
  | { type: 'token'; text: string }
  | { type: 'tool'; tool: ToolCallSummary }
  | { type: 'done'; message: ChatMessage }
  | { type: 'error'; error: string; assistantMessageId?: string; userMessageId?: string };

/** POST a question and read the Server-Sent Events stream (fetch is used because EventSource can't send headers). */
export async function streamChat(
  workspaceId: string,
  body: { message?: string; retryOfMessageId?: string },
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const headers = { ...(await authHeader()), 'Content-Type': 'application/json' };
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/workspaces/${workspaceId}/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Cannot reach the server. Is the API running?', 0);
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const dataLine = raw.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue; // keep-alive comment
      const event = JSON.parse(dataLine.slice(5).trim()) as ChatStreamEvent;
      if (event.type === 'done' || event.type === 'error') finished = true;
      onEvent(event);
    }
  }
  if (!finished) {
    onEvent({ type: 'error', error: 'The connection was interrupted. Reload to see if the answer was saved, or retry.' });
  }
}
