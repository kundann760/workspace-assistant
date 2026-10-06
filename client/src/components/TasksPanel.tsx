import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Task, Workspace } from '../types';

export default function TasksPanel({ workspace }: { workspace: Workspace }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api<{ tasks: Task[] }>(`/workspaces/${workspace.id}/tasks`)
      .then((d) => setTasks(d.tasks))
      .catch((err) => setError(err.message));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  const toggle = async (t: Task) => {
    await api(`/workspaces/${workspace.id}/tasks/${t.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: t.status === 'open' ? 'done' : 'open' }),
    }).catch((err) => setError(err.message));
    load();
  };

  const remove = async (t: Task) => {
    await api(`/workspaces/${workspace.id}/tasks/${t.id}`, { method: 'DELETE' }).catch((err) => setError(err.message));
    load();
  };

  return (
    <div className="card">
      <h3>Tasks ({tasks.length})</h3>
      <p className="muted small">Tasks are created by the assistant's <code>save_task</code> tool — ask it in the chat, e.g. “save a task to …”.</p>
      {error && <div className="alert error small">{error}</div>}
      {tasks.length === 0 ? (
        <p className="muted">No tasks yet.</p>
      ) : (
        <ul className="task-list">
          {tasks.map((t) => (
            <li key={t.id} className={t.status === 'done' ? 'done' : ''}>
              <input type="checkbox" checked={t.status === 'done'} onChange={() => toggle(t)} />
              <div className="grow">
                <div className="task-title">{t.title}</div>
                {t.notes && <div className="muted small">{t.notes}</div>}
                <div className="muted small">
                  {t.due_date ? `Due ${t.due_date} · ` : ''}created {new Date(t.created_at).toLocaleString()}
                </div>
              </div>
              <button className="icon-btn" onClick={() => remove(t)} title="Delete task">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
