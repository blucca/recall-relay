const storageKey = 'recall-relay.household.v1';
const loopback = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** The local server uses the official MCP SDK; static hosting uses the same domain engine. */
export function createClient() {
  let mode = 'connecting';
  let initialized;
  let queue = Promise.resolve();
  let lastRevision;
  let protocolVersion;

  async function connect() {
    const location = globalThis.location ?? globalThis.window?.location;
    let runtime;
    if (location && loopback.has(location.hostname) && ['http:', 'https:'].includes(location.protocol)) {
      const response = await fetch(new URL('/api/runtime', location.href), { cache: 'no-store' });
      if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
        const candidate = await response.json();
        if (candidate.application === 'recall-relay') runtime = candidate;
      }
    }
    if (runtime) {
      const { Client, StreamableHTTPClientTransport } = await import(new URL(runtime.browserSdk, location.href).href);
      const client = new Client({ name: 'recall-relay-concept-simulator', version: '0.1.0' });
      const transport = new StreamableHTTPClientTransport(new URL(runtime.endpoint, location.href));
      await client.connect(transport);
      const { tools } = await client.listTools();
      protocolVersion = transport.protocolVersion;
      mode = 'mcp';
      return {
        definitions: tools,
        async call(name, args) {
          const response = await client.callTool({ name, arguments: args });
          if (response.structuredContent) return response.structuredContent;
          const text = response.content?.find(item => item.type === 'text')?.text;
          if (text) return JSON.parse(text);
          throw new Error('The MCP tool returned an empty result. Resume the case and try again.');
        },
      };
    }

    const engine = await import('../src/engine.mjs');
    mode = 'local';
    return {
      definitions: engine.toolDefinitions,
      async call(name, args) {
        const run = () => {
          const saved = globalThis.localStorage.getItem(storageKey);
          const state = saved ? JSON.parse(saved) : engine.createState();
          const output = name === 'reset_demo'
            ? engine.executeTool(engine.createState(), 'get_case')
            : engine.executeTool(state, name, args);
          if (output.result.ok) globalThis.localStorage.setItem(storageKey, JSON.stringify(output.state));
          return output.result;
        };
        return globalThis.navigator?.locks
          ? globalThis.navigator.locks.request(storageKey, run)
          : run();
      },
    };
  }

  function callTool(name, args = {}) {
    const operation = queue.then(async () => {
      initialized ??= connect().catch(error => {
        initialized = undefined;
        mode = 'connecting';
        throw error;
      });
      const backend = await initialized;
      const properties = backend.definitions.find(tool => tool.name === name)?.inputSchema?.properties ?? {};
      const input = { ...args };
      if (properties.requestId && input.requestId === undefined) input.requestId = globalThis.crypto.randomUUID();
      if (properties.expectedRevision && input.expectedRevision === undefined && lastRevision !== undefined) {
        input.expectedRevision = lastRevision;
      }
      const result = await backend.call(name, input);
      if (result.case) lastRevision = result.case.revision;
      return result;
    });
    queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  return {
    callTool,
    reset: () => callTool('reset_demo'),
    get mode() { return mode; },
    get protocolVersion() { return protocolVersion; },
  };
}
