import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startServer, defaultRuntimeDir } from '../src/server.mjs';

const running = await startServer({
  port: 0, runtimeDir: resolve(defaultRuntimeDir, `events-smoke-${randomUUID()}`),
});
const abort = new AbortController();
const timeout = setTimeout(() => abort.abort(new Error('Case observation timed out.')), 15_000);
let client;
let reader;
let closed = false;

async function observe() {
  const response = await fetch(`${running.url}/api/events`, {
    headers: { Origin: running.url, Accept: 'text/event-stream' }, signal: abort.signal,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return async () => {
    for (;;) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame.split('\n').find(line => line.startsWith('data: '));
        if (data) return JSON.parse(data.slice(6));
        continue;
      }
      const chunk = await reader.read();
      if (chunk.done) return null;
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  };
}

try {
  let next = await observe();
  const initial = await next();
  assert.equal(initial.ok, true);
  assert.equal(initial.case.revision, 0);
  assert.equal(initial.change, undefined);

  const denied = await fetch(`${running.url}/api/events`, { headers: { Origin: 'https://other.example' } });
  assert.equal(denied.status, 403);
  await denied.json();

  client = new Client({ name: 'recall-relay-external-observer-smoke', version: '0.1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', running.url)));
  const result = await client.callTool({
    name: 'check_model', arguments: { model: 'OP301 I07', confirmedFromLabel: true },
  });
  assert.equal(result.isError, false);
  const changed = await next();
  assert.deepEqual(changed.case, result.structuredContent.case);
  assert.equal(changed.case.revision, initial.case.revision + 1);
  assert.equal(changed.change.tool, 'check_model');
  assert.ok(Number.isFinite(Date.parse(changed.change.at)));
  const saved = JSON.parse(await readFile(running.stateFile, 'utf8'));
  assert.equal(saved.id, changed.case.id);
  assert.equal(saved.revision, changed.case.revision);

  await reader.cancel();
  next = await observe();
  const resumed = await next();
  assert.deepEqual(resumed.case, changed.case);
  assert.equal(resumed.change, undefined);
  await client.close();
  client = undefined;
  await running.close();
  closed = true;
  assert.equal(await next(), null);
  console.log(JSON.stringify({
    ok: true,
    checks: ['initial snapshot', 'same-origin guard', 'external MCP write → committed SSE revision', 'client disconnect and snapshot reconnect', 'server close releases event stream'],
    stateFile: running.stateFile,
  }, null, 2));
} finally {
  clearTimeout(timeout);
  abort.abort();
  if (client) await client.close();
  if (!closed) await running.close();
}
