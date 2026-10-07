import { FormEvent, KeyboardEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { api, streamChat } from '../api';
import type { ChatMessage, Citation, RetrievalDebug, ToolCallSummary, Workspace } from '../types';
import RetrievalDebugView from './RetrievalDebugView';

const SUGGESTIONS = [
  'What is the launch code word for Project Falcon?',
  'Summarise the main launch risks and save a task to order the batteries.',
  'How many days of paid leave do employees get?',
];

/** Render answer text: **bold** and [n] citation markers become styled elements. */
function renderAnswer(text: string, citations: Citation[]): ReactNode[] {
  const known = new Map(citations.map((c) => [c.id, c]));
  return text.split(/(\*\*[^*]+\*\*|\[\d+(?:\s*,\s*\d+)*\])/g).map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    const m = /^\[(\d+(?:\s*,\s*\d+)*)\]$/.exec(part);
    if (m) {
      return m[1].split(',').map((n) => {
        const c = known.get(Number(n.trim()));
        return (
          <sup key={`${i}-${n}`} className="cite" title={c ? `${c.filename}${c.section ? ' › ' + c.section : ''}` : 'source'}>
            [{n.trim()}]
          </sup>
        );
      });
    }
    return <span key={i}>{part}</span>;
  });
}

function ToolChips({ tools }: { tools: ToolCallSummary[] }) {
  if (!tools.length) return null;
  return (
    <div className="tool-chips">
      {tools.map((t, i) => (
        <span key={t.id ?? i} className={`chip ${t.status}`} title={t.error ?? JSON.stringify(t.args)}>
          🔧 {t.name} · {t.status}
        </span>
      ))}
    </div>
  );
}

/** The assistant's clear_workspace_data tool only asks; deletion happens when the user clicks here. */
function ClearWorkspaceConfirm({ workspace, disabled, onCleared }: { workspace: Workspace; disabled: boolean; onCleared: () => void }) {
  const [state, setState] = useState<'idle' | 'working' | 'cancelled'>('idle');
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!confirm(`Permanently delete ALL documents, chat history, tasks and logs in “${workspace.name}”? This cannot be undone.`)) return;
    setState('working');
    setError(null);
    try {
      await api(`/workspaces/${workspace.id}/clear`, { method: 'POST' });
      onCleared();
    } catch (err) {
      setError((err as Error).message);
      setState('idle');
    }
  };

  if (state === 'cancelled') return <div className="muted small">Deletion cancelled. Nothing was deleted.</div>;
  return (
    <div className="alert error small">
      The assistant wants to delete <b>everything</b> in this workspace: documents, chat history, tasks, tool calls and
      observability data.{' '}
      <button className="small-btn" disabled={disabled || state === 'working'} onClick={run}>
        {state === 'working' ? 'Deleting…' : '🗑 Delete everything'}
      </button>{' '}
      <button className="link small" disabled={state === 'working'} onClick={() => setState('cancelled')}>
        Cancel
      </button>
      {error && <div>{error}</div>}
    </div>
  );
}

export default function ChatPanel({ workspace, onWorkspaceCleared }: { workspace: Workspace; onWorkspaceCleared?: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const { messages } = await api<{ messages: ChatMessage[] }>(`/workspaces/${workspace.id}/messages`);
      setMessages(messages);
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const patchMessage = (id: string, patch: (m: ChatMessage) => ChatMessage) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? patch(m) : m)));

  const ask = async (body: { message?: string; retryOfMessageId?: string }) => {
    setBusy(true);
    const tempUserId = `temp-user-${Date.now()}`;
    const tempAssistantId = `temp-assistant-${Date.now()}`;
    let assistantId = tempAssistantId;
    const now = new Date().toISOString();
    const blank = (id: string, role: 'user' | 'assistant', content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
      id, role, content, status: 'complete', reply_to: null, citations: [], retrieval: null, metrics: null,
      error: null, created_at: now, tool_calls: [], ...extra,
    });

    setMessages((prev) => {
      let next = prev;
      if (body.retryOfMessageId) {
        next = prev.filter((m) => !(m.role === 'assistant' && m.reply_to === body.retryOfMessageId));
        const idx = next.findIndex((m) => m.id === body.retryOfMessageId);
        const assistant = blank(tempAssistantId, 'assistant', '', { status: 'pending', reply_to: body.retryOfMessageId });
        return idx >= 0 ? [...next.slice(0, idx + 1), assistant, ...next.slice(idx + 1)] : [...next, assistant];
      }
      return [...next, blank(tempUserId, 'user', body.message ?? ''), blank(tempAssistantId, 'assistant', '', { status: 'pending' })];
    });

    try {
      await streamChat(workspace.id, body, (event) => {
        switch (event.type) {
          case 'start':
            assistantId = event.assistantMessageId;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempUserId
                  ? { ...m, id: event.userMessageId }
                  : m.id === tempAssistantId
                    ? { ...m, id: event.assistantMessageId, reply_to: event.userMessageId }
                    : m,
              ),
            );
            break;
          case 'retrieval':
            patchMessage(assistantId, (m) => ({ ...m, retrieval: event.retrieval as RetrievalDebug }));
            break;
          case 'token':
            patchMessage(assistantId, (m) => ({ ...m, content: m.content + event.text }));
            break;
          case 'tool':
            patchMessage(assistantId, (m) => ({ ...m, tool_calls: [...m.tool_calls, event.tool] }));
            break;
          case 'done':
            patchMessage(assistantId, () => event.message);
            break;
          case 'error':
            patchMessage(event.assistantMessageId ?? assistantId, (m) => ({ ...m, status: 'error', error: event.error }));
            break;
        }
      });
    } catch (err) {
      patchMessage(assistantId, (m) => ({ ...m, status: 'error', error: (err as Error).message }));
      if (!body.retryOfMessageId && assistantId === tempAssistantId) {
        // The request never reached the server: put the question back in the box so it isn't lost.
        setMessages((prev) => prev.filter((m) => m.id !== tempUserId && m.id !== tempAssistantId));
        setInput(body.message ?? '');
        setLoadError(`Could not send: ${(err as Error).message}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setLoadError(null);
    ask({ message: text });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const clear = async () => {
    if (!confirm('Clear the chat history of this workspace?')) return;
    await api(`/workspaces/${workspace.id}/messages`, { method: 'DELETE' });
    setMessages([]);
  };

  return (
    <div className="chat">
      <div className="chat-toolbar">
        <span className="muted small">
          Answers come only from documents in <b>{workspace.name}</b> (plus documents explicitly shared into it).
        </span>
        {messages.length > 0 && (
          <button className="link small" onClick={clear}>
            Clear history
          </button>
        )}
      </div>

      <div className="messages">
        {loadError && <div className="alert error">{loadError}</div>}
        {messages.length === 0 && !loadError && (
          <div className="empty-chat">
            <p className="muted">Ask anything about this workspace's documents. Try:</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="suggestion" onClick={() => setInput(s)}>
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="msg user">
              <div className="bubble">{m.content}</div>
            </div>
          ) : (
            <div key={m.id} className="msg assistant">
              <div className="bubble">
                <ToolChips tools={m.tool_calls ?? []} />
                {m.status === 'complete' &&
                  m.tool_calls?.some((t) => t.name === 'clear_workspace_data' && t.status === 'success') && (
                    <ClearWorkspaceConfirm
                      workspace={workspace}
                      disabled={busy}
                      onCleared={() => {
                        setMessages([]);
                        onWorkspaceCleared?.();
                      }}
                    />
                  )}
                {m.content ? (
                  <div className="answer">{renderAnswer(m.content, m.citations ?? [])}</div>
                ) : m.status === 'pending' ? (
                  <div className="muted typing">Thinking…</div>
                ) : null}
                {m.status === 'pending' && m.content && <span className="cursor">▍</span>}

                {m.status === 'error' && (
                  <div className="alert error small">
                    {m.error ?? 'Something went wrong.'}{' '}
                    {m.reply_to && !m.reply_to.startsWith('temp-') && (
                      <button className="small-btn" disabled={busy} onClick={() => ask({ retryOfMessageId: m.reply_to! })}>
                        ↻ Retry
                      </button>
                    )}
                  </div>
                )}

                {m.citations?.length > 0 && (
                  <div className="citations">
                    {m.citations.map((c) => (
                      <details key={c.id} className="citation">
                        <summary>
                          [{c.id}] {c.filename}
                          {c.section ? ` › ${c.section}` : ''}
                          {c.shared && <span className="chip shared">shared</span>}
                        </summary>
                        <blockquote>{c.snippet}…</blockquote>
                      </details>
                    ))}
                  </div>
                )}

                {m.retrieval && <RetrievalDebugView retrieval={m.retrieval} activeWorkspaceId={workspace.id} />}

                {m.metrics && m.status === 'complete' && (
                  <div className="metrics-line">
                    {m.metrics.latencyMs} ms · {m.metrics.totalTokens ?? 0} tokens · {m.metrics.llmCalls} LLM call(s) ·
                    retrieval {m.metrics.retrievalHit ? 'hit' : 'miss'}
                  </div>
                )}
              </div>
            </div>
          ),
        )}
        <div ref={bottomRef} />
      </div>

      <form className="composer" onSubmit={submit}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask a question, or e.g. “save a task to …” (Enter to send, Shift+Enter for a new line)"
          rows={2}
          maxLength={4000}
        />
        <button className="primary" disabled={busy || !input.trim()}>
          {busy ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
