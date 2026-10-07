import { FormEvent, useEffect, useState } from 'react';
import { api } from '../api';
import type { NotificationItem, Workspace } from '../types';

const PROVIDER_LABEL = { discord: 'Discord', slack: 'Slack', webhook: 'a webhook' } as const;
type Provider = keyof typeof PROVIDER_LABEL | null;

export default function NotificationsPanel({ workspace }: { workspace: Workspace }) {
  const [provider, setProvider] = useState<Provider>(null);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const load = () =>
    api<{ provider: Provider; notifications: NotificationItem[] }>(`/workspaces/${workspace.id}/notifications`)
      .then((d) => {
        setProvider(d.provider);
        setItems(d.notifications);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoaded(true));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    setError(null);
    setSent(false);
    try {
      await api(`/workspaces/${workspace.id}/notifications`, { method: 'POST', body: JSON.stringify({ message: message.trim() }) });
      setMessage('');
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
      load();
    }
  };

  return (
    <div className="card">
      <h3>Notifications</h3>
      {loaded &&
        (provider ? (
          <p className="muted small">
            Messages are posted to your team's <b>{PROVIDER_LABEL[provider]}</b> channel, prefixed with the workspace name. The
            assistant can also send them: ask in the chat, e.g. “send a summary of the launch risks to the channel”.
          </p>
        ) : (
          <div className="alert info small">
            Notifications are not configured. Set <code>NOTIFY_WEBHOOK_URL</code> in <code>server/.env</code> to a Slack or Discord
            incoming-webhook URL and restart the API.
          </div>
        ))}

      <form className="row" onSubmit={send}>
        <input
          className="grow"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={provider ? 'Write a message to post to the channel…' : 'Configure a webhook first'}
          maxLength={1500}
          disabled={!provider || sending}
        />
        <button className="primary" disabled={!provider || sending || !message.trim()}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
      {sent && <div className="muted small">✅ Sent.</div>}
      {error && <div className="alert error small">{error}</div>}

      <h4>History ({items.length})</h4>
      {items.length === 0 ? (
        <p className="muted">No notifications sent from this workspace yet.</p>
      ) : (
        <table className="table small">
          <thead>
            <tr>
              <th>When</th>
              <th>From</th>
              <th>Message</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((n) => (
              <tr key={n.id}>
                <td>{new Date(n.created_at).toLocaleString()}</td>
                <td>{n.source === 'user' ? 'You' : 'Assistant'}</td>
                <td>{n.message ?? '—'}</td>
                <td>
                  <span className={`chip ${n.status}`} title={n.error ?? ''}>
                    {n.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
