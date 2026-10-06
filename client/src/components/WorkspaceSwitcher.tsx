import { FormEvent, useState } from 'react';
import { api } from '../api';
import type { Workspace } from '../types';

interface Props {
  workspaces: Workspace[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onChanged: (newActiveId?: string) => Promise<void>;
}

export default function WorkspaceSwitcher({ workspaces, activeId, onSelect, onChanged }: Props) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { workspace } = await api<{ workspace: Workspace }>('/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      setName('');
      await onChanged(workspace.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (ws: Workspace) => {
    if (!confirm(`Delete workspace "${ws.name}" and ALL its documents, chats and tasks? This cannot be undone.`)) return;
    try {
      await api(`/workspaces/${ws.id}`, { method: 'DELETE' });
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="switcher">
      <div className="muted small label">Workspaces</div>
      <ul>
        {workspaces.map((ws) => (
          <li key={ws.id} className={ws.id === activeId ? 'active' : ''}>
            <button className="ws-btn" onClick={() => onSelect(ws.id)} title={ws.name}>
              <span className="ellipsis">{ws.name}</span>
              <span className="badge">{ws.document_count}</span>
            </button>
            <button className="icon-btn" onClick={() => remove(ws)} title="Delete workspace" aria-label="Delete workspace">
              ×
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={create} className="row">
        <input placeholder="New workspace name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        <button disabled={busy || !name.trim()}>Add</button>
      </form>
      {error && <div className="alert error small">{error}</div>}
    </div>
  );
}
