import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { col, deleteWhere, parseJson } from '../lib/firestore';
import { runChat, ChatEvent } from '../services/chat';

export const chatRouter = Router();

const chatLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.uid ?? 'anonymous',
  message: { error: 'Too many questions — please wait a minute.' },
});

const chatSchema = z.union([
  z.object({ message: z.string().trim().min(1).max(4000), retryOfMessageId: z.undefined().optional() }),
  z.object({ retryOfMessageId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), message: z.string().optional() }),
]);

/** Chat history for the active workspace (oldest first), with each answer's tool calls attached. */
chatRouter.get('/messages', async (req, res) => {
  const ws = req.workspace!.id;
  const [messageSnap, toolSnap] = await Promise.all([
    col.messages.where('workspace_id', '==', ws).get(),
    col.toolCalls.where('workspace_id', '==', ws).get(),
  ]);

  const toolsByMessage = new Map<string, unknown[]>();
  toolSnap.docs
    .sort((x, y) => String(x.get('created_at')).localeCompare(String(y.get('created_at'))))
    .forEach((t) => {
      const list = toolsByMessage.get(t.get('message_id')) ?? [];
      list.push({
        id: t.id,
        name: t.get('tool_name'),
        args: parseJson(t.get('arguments')),
        status: t.get('status'),
        error: t.get('error'),
        latencyMs: t.get('latency_ms'),
      });
      toolsByMessage.set(t.get('message_id'), list);
    });

  const messages = messageSnap.docs
    .map((d) => ({ id: d.id, ...d.data(), tool_calls: toolsByMessage.get(d.id) ?? [], seq: d.get('seq') as number }))
    .sort((x, y) => x.seq - y.seq)
    .slice(-200);
  res.json({ messages });
});

chatRouter.delete('/messages', async (req, res) => {
  await deleteWhere(col.messages.where('workspace_id', '==', req.workspace!.id));
  res.status(204).end();
});

/** Ask a question. Responds with a Server-Sent Events stream (start → retrieval → token* / tool* → done|error). */
chatRouter.post('/chat', chatLimiter, async (req, res) => {
  const body = chatSchema.parse(req.body ?? {});

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const emit = (event: ChatEvent) => {
    // If the browser went away we keep working (the answer is still saved), we just stop writing.
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };
  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(': keep-alive\n\n');
  }, 15_000);

  try {
    await runChat({
      workspace: { id: req.workspace!.id, name: req.workspace!.name },
      userId: req.user!.uid,
      question: body.message ?? '',
      retryOfMessageId: body.retryOfMessageId,
      emit,
    });
  } catch {
    emit({ type: 'error', error: 'Something went wrong. Your question was saved — please retry.' });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});
