import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { DocumentItem, SharedInDocument, Workspace } from '../types';

interface UploadResult {
  filename: string;
  ok: boolean;
  duplicate?: boolean;
  error?: string;
  document?: DocumentItem;
}

const formatSize = (bytes: number) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`);

export default function DocumentsPanel({
  workspace,
  workspaces,
  onChanged,
}: {
  workspace: Workspace;
  workspaces: Workspace[];
  onChanged: () => void;
}) {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [sharedIn, setSharedIn] = useState<SharedInDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const data = await api<{ documents: DocumentItem[]; sharedIn: SharedInDocument[] }>(
        `/workspaces/${workspace.id}/documents`,
      );
      setDocuments(data.documents);
      setSharedIn(data.sharedIn);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    setUploading(true);
    setError(null);
    setResults([]);
    try {
      const data = await api<{ results: UploadResult[] }>(`/workspaces/${workspace.id}/documents`, {
        method: 'POST',
        body: form,
      });
      setResults(data.results);
      await load();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const remove = async (doc: DocumentItem) => {
    if (!confirm(`Delete "${doc.filename}" and its ${doc.chunk_count} chunks?`)) return;
    await api(`/workspaces/${workspace.id}/documents/${doc.id}`, { method: 'DELETE' }).catch((err) => setError(err.message));
    await load();
    onChanged();
  };

  const share = async (doc: DocumentItem, targetWorkspaceId: string) => {
    if (!targetWorkspaceId) return;
    await api(`/workspaces/${workspace.id}/documents/${doc.id}/shares`, {
      method: 'POST',
      body: JSON.stringify({ targetWorkspaceId }),
    }).catch((err) => setError(err.message));
    await load();
  };

  const unshare = async (doc: DocumentItem, targetWorkspaceId: string) => {
    await api(`/workspaces/${workspace.id}/documents/${doc.id}/shares/${targetWorkspaceId}`, { method: 'DELETE' }).catch(
      (err) => setError(err.message),
    );
    await load();
  };

  const others = workspaces.filter((w) => w.id !== workspace.id);

  return (
    <div className="stack">
      <div className="card">
        <h3>Upload documents</h3>
        <p className="muted small">
          PDF, Markdown, TXT, CSV or JSON · up to 5 files · 10 MB each. Files are chunked, embedded and stored in the shared
          vector store tagged with this workspace. Re-uploading identical content is detected and skipped.
        </p>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".pdf,.md,.markdown,.txt,.csv,.json"
          onChange={upload}
          disabled={uploading}
        />
        {uploading && <div className="muted small">Uploading and embedding… this can take a little while for large PDFs.</div>}
        {results.map((r) => (
          <div key={r.filename} className={`alert small ${r.ok ? 'info' : 'error'}`}>
            {r.filename}:{' '}
            {r.ok ? (r.duplicate ? 'already in this workspace — skipped (no duplicate chunks)' : `ingested (${r.document?.chunk_count} chunks)`) : r.error}
          </div>
        ))}
        {error && <div className="alert error small">{error}</div>}
      </div>

      <div className="card">
        <h3>Documents in this workspace ({documents.length})</h3>
        {documents.length === 0 ? (
          <p className="muted">No documents yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>File</th>
                <th>Status</th>
                <th>Chunks</th>
                <th>Size</th>
                <th>Shared with</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id}>
                  <td>{d.filename}</td>
                  <td>
                    <span className={`chip ${d.status === 'ready' ? 'success' : d.status === 'failed' ? 'error' : ''}`} title={d.error ?? ''}>
                      {d.status}
                    </span>
                  </td>
                  <td>{d.chunk_count}</td>
                  <td>{formatSize(d.size_bytes)}</td>
                  <td>
                    {d.shared_with.map((s) => (
                      <span key={s.workspaceId} className="chip shared">
                        {s.workspaceName}{' '}
                        <button className="icon-btn" title="Stop sharing" onClick={() => unshare(d, s.workspaceId)}>
                          ×
                        </button>
                      </span>
                    ))}
                    {others.length > 0 && d.status === 'ready' && (
                      <select value="" onChange={(e) => share(d, e.target.value)} className="small-select" title="Opt-in: make this document searchable from another of your workspaces">
                        <option value="">Share to…</option>
                        {others
                          .filter((w) => !d.shared_with.some((s) => s.workspaceId === w.id))
                          .map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name}
                            </option>
                          ))}
                      </select>
                    )}
                  </td>
                  <td>
                    <button className="link danger" onClick={() => remove(d)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {sharedIn.length > 0 && (
        <div className="card">
          <h3>Shared into this workspace ({sharedIn.length})</h3>
          <p className="muted small">These documents were explicitly shared from your other workspaces and are searchable here.</p>
          <ul>
            {sharedIn.map((d) => (
              <li key={d.id}>
                {d.filename} <span className="muted small">from {d.source_workspace_name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
