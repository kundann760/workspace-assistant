import { useEffect, useState } from 'react';
import { api } from '../api';
import type { ToolCallLog, Workspace } from '../types';

export default function ToolLogPanel({ workspace }: { workspace: Workspace }) {
  const [calls, setCalls] = useState<ToolCallLog[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ toolCalls: ToolCallLog[] }>(`/workspaces/${workspace.id}/tool-calls`)
      .then((d) => setCalls(d.toolCalls))
      .catch((err) => setError(err.message));
  }, [workspace.id]);

  return (
    <div className="card">
      <h3>Tool-call log ({calls.length})</h3>
      <p className="muted small">
        Every tool the model asked for — including rejected ones (unknown tool or invalid arguments), which were never executed.
      </p>
      {error && <div className="alert error small">{error}</div>}
      {calls.length === 0 ? (
        <p className="muted">No tool calls yet.</p>
      ) : (
        <table className="table small">
          <thead>
            <tr>
              <th>When</th>
              <th>Tool</th>
              <th>Status</th>
              <th>Arguments</th>
              <th>Result / error</th>
              <th>ms</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.id}>
                <td title={c.question ?? ''}>{new Date(c.created_at).toLocaleString()}</td>
                <td>
                  <code>{c.tool_name}</code>
                </td>
                <td>
                  <span className={`chip ${c.status}`}>{c.status}</span>
                </td>
                <td>
                  <pre className="json">{JSON.stringify(c.arguments, null, 1)}</pre>
                </td>
                <td>
                  <pre className="json">{c.error ?? JSON.stringify(c.result, null, 1)}</pre>
                </td>
                <td>{c.latency_ms ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
