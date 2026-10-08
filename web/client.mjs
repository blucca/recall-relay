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
        watch(onUpdate, onStatus) {
          const events = new EventSource(new URL(runtime.events ?? '/api/events', location.href));
          events.onopen = () => onStatus('connected');
          events.onerror = () => onStatus('reconnecting');
          events.onmessage = (event) => {
            let result;
            try { result = JSON.parse(event.data); } catch { return; }
            onUpdate(result);
          };
          return () => events.close();
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
          if (output.result.ok) {
            const serialized = JSON.stringify(output.state);
            if (serialized !== saved) globalThis.localStorage.setItem(storageKey, serialized);
          }
          return output.result;
        };
        return globalThis.navigator?.locks
          ? globalThis.navigator.locks.request(storageKey, run)
          : run();
      },
      watch(onUpdate, onStatus) {
        let active = true;
        let refreshing;
        const refresh = () => {
          if (!active || refreshing) return;
          refreshing = callTool('get_case').then(result => {
            if (!active) return;
            onStatus('browser-local');
            onUpdate(result);
          }).catch(() => { if (active) onStatus('reconnecting'); })
            .finally(() => { refreshing = undefined; });
        };
        const storage = (event) => {
          if (event.key === storageKey || event.key === null) refresh();
        };
        const visible = () => { if (document.visibilityState === 'visible') refresh(); };
        window.addEventListener('storage', storage);
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', visible);
        refresh();
        return () => {
          active = false;
          window.removeEventListener('storage', storage);
          window.removeEventListener('focus', refresh);
          document.removeEventListener('visibilitychange', visible);
        };
      },
    };
  }

  function initialize() {
    initialized ??= connect().catch(error => {
      initialized = undefined;
      mode = 'connecting';
      throw error;
    });
    return initialized;
  }

  function callTool(name, args = {}) {
    const operation = queue.then(async () => {
      const backend = await initialize();
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

  /** Observe committed case snapshots; tool execution stays on the selected backend. */
  function watch(onUpdate, onStatus = () => {}) {
    let active = true;
    let stop;
    let retry;
    let seen;
    const status = value => { if (active) onStatus(value); };
    const update = result => {
      if (!active || !result?.ok || !result.case) return;
      lastRevision = result.case.revision;
      const key = `${result.case.id}:${result.case.revision}`;
      if (seen === key) return;
      seen = key;
      onUpdate(result);
    };
    const start = async () => {
      try {
        const backend = await initialize();
        if (active) stop = backend.watch(update, status);
      } catch {
        if (!active) return;
        status('reconnecting');
        retry = setTimeout(start, 1500);
      }
    };
    void start();
    return () => { active = false; clearTimeout(retry); stop?.(); };
  }

  return {
    callTool, watch,
    reset: () => callTool('reset_demo'),
    get mode() { return mode; },
    get protocolVersion() { return protocolVersion; },
  };
}
