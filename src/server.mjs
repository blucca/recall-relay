import { createServer } from 'node:http';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { basename, dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { build } from 'esbuild';
import { createState, executeTool, toolDefinitions } from './engine.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const workspaceRoot = process.env.RECALL_RELAY_WORKSPACE_ROOT ||
  (basename(dirname(projectRoot.slice(0, -1))) === 'products' ? resolve(projectRoot, '../..') : projectRoot);
export const defaultRuntimeDir = resolve(workspaceRoot, 'temp/recall-relay-runtime');
const resetTool = {
  name: 'reset_demo',
  description: 'Start a fresh local sample household. Replaces this server instance’s saved case and journal.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
};
const mime = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function writeState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const pending = `${path}.${process.pid}.${randomUUID()}.pending`;
  await writeFile(pending, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(pending, path);
}

async function loadState(path) {
  try {
    const state = JSON.parse(await readFile(path, 'utf8'));
    if (state.schemaVersion !== 1 || !executeTool(state, 'get_case').result.ok) {
      throw new Error('Saved state validation failed. Select a fresh RECALL_RELAY_STATE_FILE to start another household.');
    }
    return state;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const state = createState();
    await writeState(path, state);
    return state;
  }
}

async function browserSdk(runtimeDir) {
  await mkdir(runtimeDir, { recursive: true });
  const outfile = resolve(runtimeDir, 'mcp-client.mjs');
  await build({
    stdin: {
      contents: "export { Client } from '@modelcontextprotocol/sdk/client/index.js';\nexport { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';",
      resolveDir: projectRoot,
      sourcefile: 'recall-relay-browser-sdk.mjs',
    },
    outfile, bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
    minify: true, legalComments: 'inline', logLevel: 'silent',
  });
  return outfile;
}

/** A single local household, persisted independently of MCP transport sessions. */
export async function startServer(options = {}) {
  const host = options.host ?? process.env.RECALL_RELAY_HOST ?? '127.0.0.1';
  const port = Number(options.port ?? process.env.RECALL_RELAY_PORT ?? 4317);
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('This single-household development server uses a loopback host: 127.0.0.1, localhost, or ::1.');
  }
  const runtimeDir = resolve(options.runtimeDir ?? defaultRuntimeDir);
  const stateFile = resolve(options.stateFile ?? process.env.RECALL_RELAY_STATE_FILE ?? resolve(runtimeDir, 'state.json'));
  let state = await loadState(stateFile);
  const clientBundle = await browserSdk(runtimeDir);
  let queue = Promise.resolve();
  let activePort;

  function runTool(name, args) {
    const operation = queue.then(async () => {
      const output = name === 'reset_demo'
        ? executeTool(createState(), 'get_case')
        : executeTool(structuredClone(state), name, args);
      if (output.result.ok && (name === 'reset_demo' || JSON.stringify(output.state) !== JSON.stringify(state))) {
        await writeState(stateFile, output.state);
        state = output.state;
      }
      return output.result;
    });
    queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  function createMcpServer() {
    const server = new Server({ name: 'recall-relay', version: '0.1.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...toolDefinitions, resetTool] }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const result = await runTool(request.params.name, request.params.arguments ?? {});
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
        isError: !result.ok,
      };
    });
    return server;
  }

  const httpServer = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const hosts = new Set([`127.0.0.1:${activePort}`, `localhost:${activePort}`, `[::1]:${activePort}`]);
    if (!hosts.has(request.headers.host)) return json(response, 403, { error: 'Use this server’s loopback URL.' });
    if (request.headers.origin && ![...hosts].some(value => request.headers.origin === `http://${value}`)) {
      return json(response, 403, { error: 'Use the local Recall Relay page for this household.' });
    }
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/mcp') {
        if (request.method !== 'POST') {
          response.setHeader('Allow', 'POST');
          return json(response, 405, { error: 'This stateless Streamable HTTP endpoint accepts POST requests.' });
        }
        const server = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 256 * 1024,
        });
        response.once('close', () => { void server.close(); });
        await server.connect(transport);
        await transport.handleRequest(request, response);
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.setHeader('Allow', 'GET, HEAD');
        return json(response, 405, { error: 'Use GET or HEAD for local resources.' });
      }
      if (pathname === '/api/runtime') {
        return json(response, 200, {
          application: 'recall-relay', mode: 'mcp', transport: 'streamable-http',
          protocolVersion: LATEST_PROTOCOL_VERSION, endpoint: '/mcp', browserSdk: '/vendor/mcp-client.mjs',
          scope: 'one local household', persistence: 'local state file',
        });
      }
      let file;
      if (pathname === '/vendor/mcp-client.mjs') file = clientBundle;
      else {
        const match = pathname.match(/^\/(src|data|web)\/(.*)$/);
        const directory = resolve(projectRoot, match?.[1] ?? 'web');
        const relative = match ? (match[2] || 'index.html') : (pathname === '/' ? 'index.html' : pathname.slice(1));
        file = resolve(directory, relative);
        if (!file.startsWith(`${directory}${sep}`) || !mime[extname(file)]) {
          return json(response, 404, { error: 'Resource unavailable.' });
        }
      }
      const body = await readFile(file);
      response.writeHead(200, { 'Content-Type': mime[extname(file)], 'Content-Length': body.length });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      if (response.headersSent) { response.destroy(error); return; }
      if (error.code === 'ENOENT' || error.code === 'EISDIR') return json(response, 404, { error: 'Resource unavailable.' });
      console.error('Recall Relay request failed:', error.message);
      json(response, 500, { error: 'Local request failed. See the server log; saved household state is retained.' });
    }
  });
  httpServer.requestTimeout = 30_000;
  httpServer.headersTimeout = 10_000;
  await new Promise((done, fail) => {
    httpServer.once('error', fail);
    httpServer.listen(port, host, () => { httpServer.off('error', fail); done(); });
  });
  activePort = httpServer.address().port;
  const url = `http://${host === '::1' ? '[::1]' : host}:${activePort}`;
  return {
    server: httpServer, url, stateFile,
    async close() {
      await queue;
      httpServer.closeIdleConnections();
      await new Promise((done, fail) => httpServer.close(error => error ? fail(error) : done()));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const running = await startServer();
    console.log(JSON.stringify({ event: 'listening', url: running.url, protocolVersion: LATEST_PROTOCOL_VERSION, stateFile: running.stateFile }));
    let stopping = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
      if (stopping) return;
      stopping = true;
      await running.close();
      process.exit(0);
    });
  } catch (error) {
    console.error(`Recall Relay startup failed: ${error.message}`);
    process.exitCode = 1;
  }
}
