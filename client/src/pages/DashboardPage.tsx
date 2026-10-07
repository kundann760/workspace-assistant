import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import type { Workspace } from '../types';
import WorkspaceSwitcher from '../components/WorkspaceSwitcher';
import ChatPanel from '../components/ChatPanel';
import DocumentsPanel from '../components/DocumentsPanel';
import TasksPanel from '../components/TasksPanel';
import ToolLogPanel from '../components/ToolLogPanel';
import MetricsPanel from '../components/MetricsPanel';
import NotificationsPanel from '../components/NotificationsPanel';

const TABS = ['Chat', 'Documents', 'Tasks', 'Notifications', 'Tool call Logs', 'Observability'] as const;
type Tab = (typeof TABS)[number];
const ACTIVE_KEY = 'activeWorkspaceId';

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem(ACTIVE_KEY));
  const [tab, setTab] = useState<Tab>('Chat');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const loadWorkspaces = useCallback(async () => {
    try {
      const { workspaces } = await api<{ workspaces: Workspace[] }>('/workspaces');
      setWorkspaces(workspaces);
      setActiveId((current) =>
        current && workspaces.some((w) => w.id === current) ? current : (workspaces[0]?.id ?? null),
      );
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);

  useEffect(() => {
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
  }, [activeId]);

  const seedDemo = async () => {
    setSeeding(true);
    setError(null);
    try {
      await api('/demo/seed', { method: 'POST' });
      await loadWorkspaces();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSeeding(false);
    }
  };

  const active = workspaces.find((w) => w.id === activeId) ?? null;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">📚 Workspace Assistant</div>
        <WorkspaceSwitcher
          workspaces={workspaces}
          activeId={activeId}
          onSelect={setActiveId}
          onChanged={async (newId) => {
            await loadWorkspaces();
            if (newId) setActiveId(newId);
          }}
        />
        <button className="small-btn" onClick={seedDemo} disabled={seeding} title="Creates 2 workspaces with sample docs">
          {seeding ? 'Loading demo data… (≈30s)' : '✨ Load demo workspaces'}
        </button>
        <div className="sidebar-footer">
          <div className="muted small ellipsis" title={user?.email ?? ''}>
            {user?.email ?? user?.uid}
          </div>
          <button className="link" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        {error && <div className="alert error">{error}</div>}
        {loading ? (
          <div className="muted">Loading workspaces…</div>
        ) : !active ? (
          <div className="card empty">
            <h2>Welcome!</h2>
            <p>Create your first workspace in the sidebar, or click <b>✨ Load demo workspaces</b> to get two pre-filled ones.</p>
          </div>
        ) : (
          <>
            <header className="main-header">
              <div>
                <div className="muted small">Active workspace</div>
                <h2>{active.name}</h2>
              </div>
              <nav className="tabs">
                {TABS.map((t) => (
                  <button key={t} className={t === tab ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
                    {t}
                  </button>
                ))}
              </nav>
            </header>
            {/* key={active.id} remounts panels on switch, so no state can leak between workspaces */}
            <section className="panel" key={`${active.id}-${tab}`}>
              {tab === 'Chat' && <ChatPanel workspace={active} onWorkspaceCleared={loadWorkspaces} />}
              {tab === 'Documents' && (
                <DocumentsPanel workspace={active} workspaces={workspaces} onChanged={loadWorkspaces} />
              )}
              {tab === 'Tasks' && <TasksPanel workspace={active} />}
              {tab === 'Notifications' && <NotificationsPanel workspace={active} />}
              {tab === 'Tool call Logs' && <ToolLogPanel workspace={active} />}
              {tab === 'Observability' && <MetricsPanel workspace={active} />}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
