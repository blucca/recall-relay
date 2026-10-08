import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { defaultRuntimeDir } from '../src/server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(defaultRuntimeDir, `smoke-${randomUUID()}`);
await mkdir(directory, { recursive: true });
const stateFile = resolve(directory, 'state.json');
const wire = [];
let running;
let client;

async function launch() {
  const child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: root, env: { ...process.env, RECALL_RELAY_PORT: '0', RECALL_RELAY_STATE_FILE: stateFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostic = '';
  child.stderr.on('data', data => { diagnostic += data; });
  const ready = await new Promise((done, fail) => {
    let output = '';
    const timeout = setTimeout(() => { child.kill('SIGTERM'); fail(new Error(`Server start timed out. ${diagnostic}`)); }, 20_000);
    child.once('error', error => { clearTimeout(timeout); fail(error); });
    child.once('exit', code => { clearTimeout(timeout); fail(new Error(`Server exited ${code}. ${diagnostic}`)); });
    child.stdout.on('data', data => {
      output += data;
      for (const line of output.split('\n')) {
        if (!line.trim()) continue;
        try {
          const value = JSON.parse(line);
          if (value.event === 'listening') { clearTimeout(timeout); done(value); return; }
        } catch {}
      }
    });
  });
  return {
    ...ready,
    async stop() { const stopped = once(child, 'exit'); child.kill('SIGTERM'); await stopped; },
  };
}

async function connect(url) {
  client = new Client({ name: 'recall-relay-protocol-smoke', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', url), {
    fetch: async (input, init) => {
      const request = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      const response = await fetch(input, init);
      if (request?.method) wire.push({ method: request.method, httpStatus: response.status });
      return response;
    },
  });
  await client.connect(transport);
  assert.equal(transport.protocolVersion, '2025-11-25');
  return client.listTools();
}

async function call(name, args = {}, ok = true) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, !ok);
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  assert.equal(result.structuredContent.ok, ok);
  assert.ok(result.structuredContent.case);
  return result.structuredContent;
}

try {
  running = await launch();
  const runtime = await (await fetch(`${running.url}/api/runtime`)).json();
  assert.equal(runtime.transport, 'streamable-http');
  const list = await connect(running.url);
  for (const name of ['get_case', 'check_model', 'create_handoff', 'accept_handoff', 'record_step', 'prepare_claim', 'record_claim', 'set_followup', 'reset_demo']) {
    assert.ok(list.tools.some(tool => tool.name === name), `Tool discovery: ${name}`);
  }
  await call('get_case');
  await call('check_model', { model: 'OP301 I07', confirmedFromLabel: false });
  const handoff = (await call('create_handoff', { recipientLabel: 'Demo Alex' })).handoff;
  const accepted = await call('accept_handoff', { handoff, owner: 'Demo Alex' });
  assert.equal(accepted.case.stage, 'confirm_current_owner');
  const savedBeforeError = await readFile(stateFile, 'utf8');
  const invalid = await call('record_step', { step: 'pressure_use_stopped' }, false);
  assert.equal(invalid.error.code, 'LABEL_REQUIRED');
  assert.equal(await readFile(stateFile, 'utf8'), savedBeforeError);
  const checked = await call('check_model', { model: 'OP301 I07', confirmedFromLabel: true });
  const intent = { step: 'pressure_use_stopped', requestId: 'smoke-stop-pressure', expectedRevision: checked.case.revision };
  const stopped = await call('record_step', intent);
  const replay = await call('record_step', intent);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.case.events, stopped.case.events);
  const photo = await call('record_step', { step: 'label_photo_ready' });
  const packet = await call('prepare_claim', { expectedRevision: photo.case.revision });
  assert.equal(packet.claimPacket.submission, 'prepared');
  await call('record_claim', { reference: 'DEMO-ACK-MCP-SMOKE' });
  const reminder = await call('set_followup', { dueAt: new Date(Date.now() + 7 * 86400_000).toISOString() });
  assert.match(reminder.calendarContent, /BEGIN:VCALENDAR/);
  const persisted = reminder.case;
  await client.close(); client = undefined;
  await running.stop(); running = undefined;

  running = await launch();
  await connect(running.url);
  const resumed = await call('get_case');
  assert.deepEqual(resumed.case, persisted);
  await call('record_step', { step: 'replacement_received' });
  await call('record_step', { step: 'old_lid_disposed' });
  const finished = await call('record_step', { step: 'replacement_installed' });
  assert.equal(finished.case.stage, 'resolved');
  assert.equal(finished.case.followUpAt, null);
  const artifact = await fetch(`${running.url}/data/recall.json`);
  assert.match(artifact.headers.get('content-type'), /^application\/json/);
  const engine = await fetch(`${running.url}/src/engine.mjs`);
  assert.match(engine.headers.get('content-type'), /javascript/);
  const bundle = await fetch(`${running.url}/vendor/mcp-client.mjs`);
  assert.equal(bundle.status, 200);
  await call('reset_demo');
  console.log(JSON.stringify({
    ok: true, protocol: '2025-11-25', transport: 'Streamable HTTP / official SDK',
    tools: list.tools.map(tool => tool.name),
    checks: ['initialize', 'tools/list', 'tools/call', 'structured errors preserve disk state', 'idempotent replay', 'process restart retains case', 'sample remedy flow resolved', 'static resource MIME', 'browser SDK bundle', 'explicit demo reset'],
    provenance: 'Synthetic household and DEMO acknowledgement; official manufacturer form stays external.',
    wire, stateFile,
  }, null, 2));
} finally {
  if (client) await client.close();
  if (running) await running.stop();
}
