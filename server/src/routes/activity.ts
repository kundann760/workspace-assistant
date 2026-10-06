import { Router } from 'express';
import { z } from 'zod';
import { col, parseJson } from '../lib/firestore';
import { notFound } from '../lib/errors';
import { isId } from '../middleware/auth';

/** Tasks, tool-call log and observability metrics for the active workspace. */
export const activityRouter = Router();

async function loadTask(workspaceId: string, taskId: unknown) {
  if (!isId(taskId)) throw notFound('Task');
  const snap = await col.tasks.doc(taskId).get();
  if (!snap.exists || snap.get('workspace_id') !== workspaceId) throw notFound('Task');
  return snap;
}

activityRouter.get('/tasks', async (req, res) => {
  const snap = await col.tasks.where('workspace_id', '==', req.workspace!.id).get();
  const tasks = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as { status: string; created_at: string }) }))
    // open tasks first, newest first
    .sort((a, b) => a.status.localeCompare(b.status) || b.created_at.localeCompare(a.created_at));
  res.json({ tasks });
});

activityRouter.patch('/tasks/:taskId', async (req, res) => {
  const { status } = z.object({ status: z.enum(['open', 'done']) }).parse(req.body);
  const snap = await loadTask(req.workspace!.id, req.params.taskId);
  await snap.ref.update({ status });
  res.json({ task: { id: snap.id, ...snap.data(), status } });
});

activityRouter.delete('/tasks/:taskId', async (req, res) => {
  const snap = await loadTask(req.workspace!.id, req.params.taskId);
  await snap.ref.delete();
  res.status(204).end();
});

activityRouter.get('/tool-calls', async (req, res) => {
  const ws = req.workspace!.id;
  const [toolSnap, messageSnap] = await Promise.all([
    col.toolCalls.where('workspace_id', '==', ws).get(),
    col.messages.where('workspace_id', '==', ws).get(),
  ]);
  const messages = new Map(messageSnap.docs.map((d) => [d.id, d.data()]));
  const toolCalls = toolSnap.docs
    .map((d) => {
      const data = d.data();
      const replyTo = messages.get(data.message_id)?.reply_to;
      return {
        id: d.id,
        tool_name: data.tool_name,
        arguments: parseJson(data.arguments),
        result: parseJson(data.result),
        status: data.status,
        error: data.error,
        latency_ms: data.latency_ms,
        created_at: data.created_at,
        message_id: data.message_id,
        question: replyTo ? (messages.get(replyTo)?.content ?? null) : null,
      };
    })
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 200);
  res.json({ toolCalls });
});

activityRouter.get('/metrics', async (req, res) => {
  const ws = req.workspace!.id;
  const [messageSnap, toolSnap] = await Promise.all([
    col.messages.where('workspace_id', '==', ws).get(),
    col.toolCalls.where('workspace_id', '==', ws).get(),
  ]);
  const all = messageSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Record<string, any>);
  const byId = new Map(all.map((m) => [m.id, m]));
  const answers = all.filter((m) => m.role === 'assistant' && m.metrics).sort((a, b) => b.seq - a.seq);

  const avg = (values: number[]) => (values.length ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : null);
  const nums = (key: string) => answers.map((m) => m.metrics[key]).filter((v): v is number => typeof v === 'number');
  const sum = (key: string) => nums(key).reduce((s, v) => s + v, 0);

  const summary = {
    requests: answers.length,
    failed_requests: answers.filter((m) => m.status === 'error').length,
    avg_latency_ms: avg(nums('latencyMs')),
    avg_first_token_ms: avg(nums('firstTokenMs')),
    prompt_tokens: sum('promptTokens'),
    completion_tokens: sum('completionTokens'),
    retrieval_hits: answers.filter((m) => m.metrics.retrievalHit === true).length,
    retrieval_misses: answers.filter((m) => m.metrics.retrievalHit === false).length,
  };

  const toolStats = new Map<string, { tool_name: string; success: number; error: number; rejected: number; latencies: number[] }>();
  for (const d of toolSnap.docs) {
    const name = d.get('tool_name') as string;
    const entry = toolStats.get(name) ?? { tool_name: name, success: 0, error: 0, rejected: 0, latencies: [] };
    const status = d.get('status') as 'success' | 'error' | 'rejected';
    entry[status] += 1;
    if (typeof d.get('latency_ms') === 'number') entry.latencies.push(d.get('latency_ms'));
    toolStats.set(name, entry);
  }
  const tools = [...toolStats.values()]
    .map(({ latencies, ...t }) => ({ ...t, avg_latency_ms: avg(latencies) }))
    .sort((a, b) => a.tool_name.localeCompare(b.tool_name));

  const recent = answers.slice(0, 25).map((m) => ({
    id: m.id,
    status: m.status,
    metrics: m.metrics,
    created_at: m.created_at,
    question: m.reply_to ? (byId.get(m.reply_to)?.content ?? null) : null,
  }));

  res.json({ summary, tools, recent });
});
