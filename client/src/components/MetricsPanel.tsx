import { useEffect, useState } from 'react';
import { api } from '../api';
import type { MetricsResponse, Workspace } from '../types';

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="muted small">{label}</div>
    </div>
  );
}

export default function MetricsPanel({ workspace }: { workspace: Workspace }) {
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<MetricsResponse>(`/workspaces/${workspace.id}/metrics`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [workspace.id]);

  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <div className="muted">Loading…</div>;
  const s = data.summary;
  const hitRate = s.retrieval_hits + s.retrieval_misses > 0 ? Math.round((100 * s.retrieval_hits) / (s.retrieval_hits + s.retrieval_misses)) : 0;

  return (
    <div className="stack">
      <div className="stats">
        <Stat label="Requests" value={s.requests} />
        <Stat label="Failed requests" value={s.failed_requests} />
        <Stat label="Avg latency" value={s.avg_latency_ms ? `${s.avg_latency_ms} ms` : '—'} />
        <Stat label="Avg time to first token" value={s.avg_first_token_ms ? `${s.avg_first_token_ms} ms` : '—'} />
        <Stat label="Prompt / completion tokens" value={`${s.prompt_tokens} / ${s.completion_tokens}`} />
        <Stat label="Retrieval hit rate" value={`${hitRate}% (${s.retrieval_hits}/${s.retrieval_hits + s.retrieval_misses})`} />
      </div>

      <div className="card">
        <h3>Tool outcomes</h3>
        {data.tools.length === 0 ? (
          <p className="muted">No tool calls yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Success</th>
                <th>Error</th>
                <th>Rejected</th>
                <th>Avg ms</th>
              </tr>
            </thead>
            <tbody>
              {data.tools.map((t) => (
                <tr key={t.tool_name}>
                  <td>
                    <code>{t.tool_name}</code>
                  </td>
                  <td>{t.success}</td>
                  <td>{t.error}</td>
                  <td>{t.rejected}</td>
                  <td>{t.avg_latency_ms ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Recent requests</h3>
        <table className="table small">
          <thead>
            <tr>
              <th>Question</th>
              <th>Status</th>
              <th>Latency</th>
              <th>First token</th>
              <th>Tokens (in/out)</th>
              <th>LLM calls</th>
              <th>Retrieval</th>
              <th>Tools</th>
            </tr>
          </thead>
          <tbody>
            {data.recent.map((r) => (
              <tr key={r.id}>
                <td className="ellipsis-cell" title={r.question ?? ''}>
                  {r.question}
                </td>
                <td>
                  <span className={`chip ${r.status === 'complete' ? 'success' : 'error'}`}>{r.status}</span>
                </td>
                <td>{r.metrics.latencyMs ?? '—'} ms</td>
                <td>{r.metrics.firstTokenMs ?? '—'} ms</td>
                <td>
                  {r.metrics.promptTokens ?? 0} / {r.metrics.completionTokens ?? 0}
                </td>
                <td>{r.metrics.llmCalls ?? '—'}</td>
                <td>
                  {r.metrics.retrievalHit === undefined ? '—' : r.metrics.retrievalHit ? 'hit' : 'miss'}
                  {r.metrics.topSimilarity != null && ` (${r.metrics.topSimilarity.toFixed(2)})`}
                </td>
                <td>{r.metrics.toolCalls ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
