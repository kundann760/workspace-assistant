import type { RetrievalDebug } from '../types';

const fmt = (n: number | null, digits = 3) => (n === null || n === undefined ? '—' : n.toFixed(digits));

/** Shows exactly which workspace and which chunks an answer drew from — proof that isolation holds. */
export default function RetrievalDebugView({
  retrieval,
  activeWorkspaceId,
}: {
  retrieval: RetrievalDebug;
  activeWorkspaceId: string;
}) {
  const foreign = retrieval.sources.filter((s) => s.workspaceId !== activeWorkspaceId && !s.shared);
  return (
    <details className="debug">
      <summary>
        🔍 Retrieval debug · {retrieval.sources.length} chunk(s) · {retrieval.hit ? 'hit' : 'miss'}
      </summary>
      <div className="debug-body">
        <div className="small">
          <div>
            Query workspace: <code>{retrieval.workspaceId}</code>{' '}
            {retrieval.workspaceId === activeWorkspaceId ? '✅ matches active workspace' : '⚠️ differs from active workspace'}
          </div>
          <div>
            Retrieval latency {retrieval.latencyMs} ms · similarity floor {retrieval.minSimilarity} ·{' '}
            {retrieval.droppedCount} weak candidate(s) dropped
          </div>
          {foreign.length > 0 && <div className="alert error small">⚠️ {foreign.length} chunk(s) from another workspace!</div>}
        </div>
        {retrieval.sources.length === 0 ? (
          <p className="muted small">No chunks matched — the assistant was told nothing relevant exists.</p>
        ) : (
          <table className="table small">
            <thead>
              <tr>
                <th>#</th>
                <th>Document › section</th>
                <th>Workspace</th>
                <th title="Cosine similarity">Sim.</th>
                <th title="Rank in vector search">Vec #</th>
                <th title="Rank in keyword search">KW #</th>
                <th title="Reciprocal Rank Fusion score">RRF</th>
                <th>Via</th>
              </tr>
            </thead>
            <tbody>
              {retrieval.sources.map((s) => (
                <tr key={s.chunkId} title={s.preview}>
                  <td>{s.id}</td>
                  <td>
                    {s.filename}
                    {s.section ? ` › ${s.section}` : ''} <span className="muted">(chunk {s.chunkIndex})</span>
                  </td>
                  <td>
                    <code>{s.workspaceId.slice(0, 8)}</code>
                    {s.shared && <span className="chip shared">shared-in</span>}
                  </td>
                  <td>{fmt(s.similarity)}</td>
                  <td>{s.vectorRank ?? '—'}</td>
                  <td>{s.keywordRank ?? '—'}</td>
                  <td>{fmt(s.rrfScore, 4)}</td>
                  <td>{s.origin === 'initial' ? 'initial' : 'tool'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </details>
  );
}
