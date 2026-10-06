// End-to-end test: real HTTP app + real Firestore (local emulator, incl. vector search) + a mock Gemini server.
// Needs Java (for the Firestore emulator) but no API keys. Run with: npm run test:e2e   (builds first)
// Firebase sign-in is stubbed: the bearer token "user1" means uid "user1".
const path = require('node:path');
const http = require('node:http');
const SERVER = path.resolve(__dirname, '..');
const assert = (cond, msg) => { if (!cond) { console.error('❌ FAIL:', msg); process.exitCode = 1; throw new Error(msg); } console.log('✅', msg); };

// ---------- mock Gemini ----------
const STOP = new Set('the a an of is in for to and what how do does are was be it on with by this that at as or from'.split(' '));
function embed(text) {
  const v = new Array(768).fill(0);
  for (let w of text.toLowerCase().match(/[a-z0-9]+/g) || []) {
    if (STOP.has(w)) continue;
    w = w.replace(/s$/, '');
    let h = 0; for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    v[h % 768] += 1;
  }
  return v.some((x) => x) ? v : v.map((_, i) => (i === 0 ? 1 : 0));
}
const gem = { failNext: 0, requests: [] };
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = JSON.parse(body);
    if (req.headers['x-goog-api-key'] !== 'test-key') { res.writeHead(401); return res.end('{}'); }
    if (req.url.includes(':batchEmbedContents')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ embeddings: json.requests.map((r) => ({ values: embed(r.content.parts[0].text) })) }));
    }
    if (req.url.includes(':streamGenerateContent')) {
      gem.requests.push(json);
      if (gem.failNext > 0) { gem.failNext--; res.writeHead(503); return res.end('{"error":{"message":"overloaded"}}'); }
      const last = json.contents[json.contents.length - 1];
      const sse = (chunks) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        chunks.forEach((c, i) => res.write(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: c } }], ...(i === chunks.length - 1 ? { usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 } } : {}) })}\r\n\r\n`));
        res.end();
      };
      if (last.parts.some((p) => p.functionResponse)) {
        const fr = last.parts[0].functionResponse;
        return sse([[{ text: `Tool ${fr.name} returned ` }], [{ text: fr.response.error ? 'an error.' : 'ok [1].' }]]);
      }
      const text = last.parts.map((p) => p.text || '').join('');
      const q = text.split('User question:').pop().toLowerCase();
      if (q.includes('save a task')) return sse([[{ text: 'Saving. ' }], [{ functionCall: { name: 'save_task', args: { title: 'Order VoltCell batteries', due_date: '2026-03-15' } }, thoughtSignature: 'SIG-123' }]]);
      if (q.includes('bogus')) return sse([[{ functionCall: { name: 'delete_everything', args: { confirm: true } } }]]);
      if (q.includes('bad args')) return sse([[{ functionCall: { name: 'save_task', args: { due_date: 'tomorrow' } } }]]);
      const hasSources = text.includes('<source id="1"');
      return sse(hasSources ? [[{ text: 'According to the docs, ' }], [{ text: 'the answer is there [1].' }]] : [[{ text: "I don't know based on the documents in this workspace." }]]);
    }
    res.writeHead(404); res.end('{}');
  });
});

async function sseChat(base, token, wsId, body) {
  const res = await fetch(`${base}/api/workspaces/${wsId}/chat`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  const events = text.split('\n\n').map((b) => b.split('\n').find((l) => l.startsWith('data:'))).filter(Boolean).map((l) => JSON.parse(l.slice(5)));
  return { status: res.status, events, done: events.find((e) => e.type === 'done'), error: events.find((e) => e.type === 'error'), tools: events.filter((e) => e.type === 'tool').map((e) => e.tool), start: events.find((e) => e.type === 'start') };
}

(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run via "npm run test:e2e" so the Firestore emulator is started.');
  await new Promise((r) => mock.listen(9099, '127.0.0.1', r));

  Object.assign(process.env, {
    FIREBASE_PROJECT_ID: process.env.GCLOUD_PROJECT || 'demo-e2e', GEMINI_API_KEY: 'test-key',
    GEMINI_BASE_URL: 'http://127.0.0.1:9099/v1beta', PORT: '8089',
  });
  // Initialise firebase-admin (server's copy) for the emulator, then stub token verification.
  const { initializeApp } = require(require.resolve('firebase-admin/app', { paths: [SERVER] }));
  initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
  const fbPath = require.resolve(path.join(SERVER, 'dist/lib/firebase.js'));
  require.cache[fbPath] = { id: fbPath, filename: fbPath, loaded: true, exports: { firebaseAuth: { verifyIdToken: async (t) => { if (!t.startsWith('user')) throw new Error('bad'); return { uid: t, email: `${t}@test.dev` }; } } } };
  const { createApp } = require(path.join(SERVER, 'dist/app.js'));
  const { col } = require(path.join(SERVER, 'dist/lib/firestore.js'));
  const countWhere = async (q) => (await q.count().get()).data().count;
  const srv = createApp().listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = (method, p, token = 'user1', body) => fetch(`${base}/api${p}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: r.status === 204 ? null : await r.json() }));

  try {
    assert((await call('GET', '/workspaces', 'nope')).status === 401, 'invalid token → 401');
    assert((await fetch(`${base}/api/workspaces`)).status === 401, 'missing token → 401');

    const seed = await call('POST', '/demo/seed');
    assert(seed.status === 201, 'demo seed creates workspaces');
    const { json: { workspaces } } = await call('GET', '/workspaces');
    const A = workspaces.find((w) => w.name.includes('Workspace A')); const B = workspaces.find((w) => w.name.includes('Workspace B'));
    assert(A && B && A.document_count === 3 && B.document_count === 2, 'workspace A has 3 docs, B has 2');
    const chunkCount = async () => (await col.chunks.count().get()).data().count;
    const before = await chunkCount();
    const seed2 = await call('POST', '/demo/seed');
    assert(seed2.json.workspaces.every((w) => w.documents.every((d) => d.duplicate)) && (await chunkCount()) === before, `re-seeding is idempotent (${before} chunks, no duplicates)`);
    assert(new Set((await col.chunks.select('workspace_id').get()).docs.map((d) => d.get('workspace_id'))).size === 2, 'one shared chunks collection holds both workspaces');

    // Re-upload same content under a different filename via multipart
    const fs = require('node:fs');
    const fd = new FormData();
    fd.append('files', new Blob([fs.readFileSync(path.join(SERVER, 'sample-docs/workspace-a/project-falcon-launch-plan.md'))]), 'renamed-copy.md');
    fd.append('files', new Blob(['hello']), 'evil.exe');
    const up = await call('POST', `/workspaces/${A.id}/documents`, 'user1', fd);
    assert(up.status === 201 && up.json.results[0].duplicate === true && (await chunkCount()) === before, 'uploading identical content again → duplicate, no new chunks');
    assert(up.json.results[1].ok === false && /Unsupported/.test(up.json.results[1].error), 'unsupported file type rejected per-file');

    // Grounded answer in A
    const a1 = await sseChat(base, 'user1', A.id, { message: 'What is the launch code word for Project Falcon?' });
    assert(a1.done, 'chat in A completes');
    const r1 = a1.done.message.retrieval;
    assert(r1.workspaceId === A.id && r1.sources.length > 0 && r1.sources.every((s) => s.workspaceId === A.id), 'A retrieval only returns A chunks');
    assert(r1.sources.some((s) => s.filename === 'project-falcon-launch-plan.md'), 'falcon doc retrieved in A');
    assert(a1.done.message.citations.length === 1 && a1.done.message.citations[0].id === 1, 'citation [1] mapped to a source');
    assert(a1.events.filter((e) => e.type === 'token').length >= 2, 'answer streamed token-by-token');
    assert(a1.done.message.metrics.totalTokens === 120 && a1.done.message.metrics.retrievalHit === true, 'metrics recorded (tokens, hit)');

    // ISOLATION: same question in B
    const b1 = await sseChat(base, 'user1', B.id, { message: 'What is the launch code word for Project Falcon?' });
    const bReq = JSON.stringify(gem.requests[gem.requests.length - 1]);
    assert(!bReq.includes('BLUE-PELICAN') && !bReq.includes('Falcon —'), 'no workspace-A text reached the LLM when asking in B');
    assert(b1.done.message.retrieval.sources.every((s) => s.workspaceId === B.id), 'B retrieval contains zero A chunks');
    assert(/don't know/.test(b1.done.message.content), 'B answers "I don\'t know"');

    // Tool call with side effect + thoughtSignature round-trip
    const t1 = await sseChat(base, 'user1', A.id, { message: 'Please save a task to order the batteries' });
    assert(t1.tools.length === 1 && t1.tools[0].name === 'save_task' && t1.tools[0].status === 'success', 'save_task executed');
    const followUp = gem.requests[gem.requests.length - 1];
    const modelTurn = followUp.contents.find((c) => c.role === 'model' && c.parts.some((p) => p.functionCall));
    assert(modelTurn && modelTurn.parts.some((p) => p.thoughtSignature === 'SIG-123'), 'model turn echoed back with thoughtSignature');
    assert(t1.done.message.content.includes('Saving.') && t1.done.message.content.includes('Tool save_task returned ok'), 'tool result fed back and answer continued');
    const tasksA = await call('GET', `/workspaces/${A.id}/tasks`);
    const tasksB = await call('GET', `/workspaces/${B.id}/tasks`);
    assert(tasksA.json.tasks.length === 1 && tasksA.json.tasks[0].due_date === '2026-03-15' && tasksB.json.tasks.length === 0, 'task recorded in A only');

    // Unknown tool & bad args
    const t2 = await sseChat(base, 'user1', A.id, { message: 'bogus please' });
    assert(t2.tools[0].status === 'rejected' && t2.done, 'unknown tool rejected, chat still completes');
    const t3 = await sseChat(base, 'user1', A.id, { message: 'bad args please' });
    assert(t3.tools[0].status === 'rejected' && /title/.test(t3.tools[0].error), 'missing required arg rejected');
    assert((await call('GET', `/workspaces/${A.id}/tasks`)).json.tasks.length === 1, 'rejected calls created no tasks');
    const log = await call('GET', `/workspaces/${A.id}/tool-calls`);
    assert(log.json.toolCalls.length === 3 && log.json.toolCalls.some((t) => t.tool_name === 'delete_everything' && t.status === 'rejected'), 'tool-call log records all 3 calls');

    // LLM failure → question kept → retry
    gem.failNext = 3;
    const f1 = await sseChat(base, 'user1', A.id, { message: 'What is the pilot budget?' });
    assert(f1.error && f1.start, 'LLM failure surfaces an error event');
    let msgs = (await call('GET', `/workspaces/${A.id}/messages`)).json.messages;
    const failedUser = msgs.find((m) => m.id === f1.start.userMessageId);
    const failedAsst = msgs.find((m) => m.id === f1.start.assistantMessageId);
    assert(failedUser && failedUser.content === 'What is the pilot budget?' && failedAsst.status === 'error', 'question persisted, answer marked error');
    const retry = await sseChat(base, 'user1', A.id, { retryOfMessageId: f1.start.userMessageId });
    assert(retry.done && retry.done.message.status === 'complete', 'retry succeeds');
    msgs = (await call('GET', `/workspaces/${A.id}/messages`)).json.messages;
    assert(msgs.filter((m) => m.content === 'What is the pilot budget?').length === 1 && !msgs.some((m) => m.status === 'error'), 'retry reused the question and replaced the failed answer');

    // Cross-user isolation
    assert((await call('GET', `/workspaces/${A.id}/messages`, 'user2')).status === 404, 'another user cannot read A');
    assert((await sseChat(base, 'user2', A.id, { message: 'hi' })).status === 404, 'another user cannot chat in A');

    // Opt-in sharing
    const docs = (await call('GET', `/workspaces/${A.id}/documents`)).json.documents;
    const falcon = docs.find((d) => d.filename === 'project-falcon-launch-plan.md');
    assert((await call('POST', `/workspaces/${A.id}/documents/${falcon.id}/shares`, 'user1', { targetWorkspaceId: B.id })).status === 201, 'share falcon doc A→B');
    const b2 = await sseChat(base, 'user1', B.id, { message: 'What is the launch code word for Project Falcon?' });
    const b2src = b2.done.message.retrieval.sources;
    assert(b2src.some((s) => s.shared && s.documentId === falcon.id) && b2src.every((s) => s.workspaceId === B.id || s.documentId === falcon.id), 'B now sees ONLY the shared doc from A (flagged shared)');
    const hand = docs.find((d) => d.filename === 'acme-employee-handbook.md');
    const b2hand = await sseChat(base, 'user1', B.id, { message: 'How many days of paid leave do employees get?' });
    assert(b2hand.done.message.retrieval.sources.every((s) => s.documentId !== hand.id), 'non-shared A docs still invisible from B');
    await call('DELETE', `/workspaces/${A.id}/documents/${falcon.id}/shares/${B.id}`);
    const b3 = await sseChat(base, 'user1', B.id, { message: 'What is the launch code word for Project Falcon?' });
    assert(b3.done.message.retrieval.sources.every((s) => s.workspaceId === B.id), 'unshare restores isolation');
    const sharedToOther = await call('POST', `/workspaces/${A.id}/documents/${falcon.id}/shares`, 'user1', { targetWorkspaceId: 'someone-elses-workspace' });
    assert(sharedToOther.status === 404, 'cannot share into a workspace you do not own');

    const metrics = await call('GET', `/workspaces/${A.id}/metrics`);
    assert(metrics.status === 200 && metrics.json.summary.requests >= 5 && metrics.json.tools.length >= 2, 'metrics endpoint aggregates requests and tools');

    // Delete doc cascades chunks
    await call('DELETE', `/workspaces/${A.id}/documents/${hand.id}`);
    assert((await countWhere(col.chunks.where('document_id', '==', hand.id))) === 0, 'deleting a document removes its chunks');

    // Deleting a workspace removes everything tagged with it and its shares
    await call('POST', `/workspaces/${A.id}/documents/${falcon.id}/shares`, 'user1', { targetWorkspaceId: B.id });
    assert((await call('DELETE', `/workspaces/${B.id}`)).status === 204, 'delete workspace B');
    assert((await countWhere(col.chunks.where('workspace_id', '==', B.id))) === 0 && (await countWhere(col.messages.where('workspace_id', '==', B.id))) === 0, 'workspace B chunks + messages removed');
    assert((await countWhere(col.documents.where('shared_with', 'array-contains', B.id))) === 0, 'shares into deleted workspace removed');
    console.log(process.exitCode ? '\nSOME TESTS FAILED' : '\nALL E2E CHECKS PASSED');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    srv.close(); mock.close();
    setTimeout(() => process.exit(process.exitCode ?? 0), 200);
  }
})();
