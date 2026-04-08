import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';

export type MockScenario = 'happy' | 'slow' | 'error' | 'rate_limit';

export interface MockCopilotProcessOptions {
  scenario?: MockScenario;
  seed?: number;
}

function emit(stream: PassThrough, obj: unknown): void {
  stream.push(JSON.stringify(obj) + '\n');
}

function sleep(ms: number, signal?: { aborted: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const check = setInterval(() => {
        if (signal.aborted) {
          clearTimeout(timer);
          clearInterval(check);
          resolve();
        }
      }, 50);
      // Also clear check when timer fires
      const origResolve = resolve;
      setTimeout(() => clearInterval(check), ms + 100);
    }
  });
}

export class MockCopilotProcess extends EventEmitter {
  readonly stdin: PassThrough;
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly pid: number;
  killed = false;
  exitCode: number | null = null;

  private abort = { aborted: false };
  private stdinRl: ReturnType<typeof createInterface> | null = null;
  private pendingStdinResolvers: Array<(line: string) => void> = [];

  constructor(opts: MockCopilotProcessOptions = {}) {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.pid = Math.floor(Math.random() * 1e6) + 900000;

    // Set up stdin line reader to receive responses from the client
    this.stdinRl = createInterface({ input: this.stdin });
    this.stdinRl.on('line', (line) => {
      const resolver = this.pendingStdinResolvers.shift();
      if (resolver) resolver(line);
    });

    this.startScenario(opts.scenario ?? 'happy');
  }

  /** Wait for a JSON-RPC response from the client on stdin */
  private waitForResponse(timeoutMs = 5000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Mock: timeout waiting for client response'));
      }, timeoutMs);

      this.pendingStdinResolvers.push((line) => {
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(line) as { result?: unknown };
          resolve(parsed.result);
        } catch {
          resolve(undefined);
        }
      });
    });
  }

  private async startScenario(scenario: MockScenario): Promise<void> {
    const out = this.stdout;
    const multiplier = scenario === 'slow' ? 3 : 1;

    // Wait a tick for listeners to be attached
    await sleep(10);

    if (this.abort.aborted) return;

    // Initialize response
    emit(out, {
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: 1, agentCapabilities: {} },
    });

    await sleep(100 * multiplier, this.abort);
    if (this.abort.aborted) return;

    // session/new response
    emit(out, {
      jsonrpc: '2.0',
      id: 2,
      result: { sessionId: `mock_sess_${this.pid}` },
    });

    await sleep(400 * multiplier, this.abort);
    if (this.abort.aborted) return;

    const sessionId = `mock_sess_${this.pid}`;

    // agent_thought_chunk
    emit(out, {
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: {
          sessionUpdate: 'agent_thought_chunk',
          content: { text: 'Analyzing the repository structure...' },
        },
      },
    });

    await sleep(500 * multiplier, this.abort);
    if (this.abort.aborted) return;

    // plan
    emit(out, {
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: {
          sessionUpdate: 'plan',
          entries: [
            { content: 'Read directory', priority: 'high', status: 'pending' },
            { content: 'Analyze contents', priority: 'high', status: 'pending' },
            { content: 'Generate summary', priority: 'medium', status: 'pending' },
          ],
        },
      },
    });

    await sleep(500 * multiplier, this.abort);
    if (this.abort.aborted) return;

    // tool_call
    emit(out, {
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tc_1',
          title: 'Execute command',
          kind: 'execute',
          rawInput: { command: 'ls -la' },
        },
      },
    });

    await sleep(1000 * multiplier, this.abort);
    if (this.abort.aborted) return;

    if (scenario === 'error') {
      emit(out, {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'tc_1',
            status: 'failed',
            error: 'Permission denied',
          },
        },
      });
      this.exitCode = 1;
      setImmediate(() => this.emit('exit', 1, null));
      return;
    }

    if (scenario === 'rate_limit') {
      emit(out, {
        jsonrpc: '2.0',
        id: 3,
        error: { code: 429, message: 'rate limit exceeded — too many requests' },
      });
      this.exitCode = 1;
      setImmediate(() => this.emit('exit', 1, null));
      return;
    }

    // session/request_permission — simulate agent asking client for tool approval
    // Register waiter BEFORE emitting (emit triggers synchronous readline chain)
    const permissionResponse = this.waitForResponse();

    emit(out, {
      jsonrpc: '2.0',
      id: 100,
      method: 'session/request_permission',
      params: {
        sessionId,
        toolCall: { toolCallId: 'tc_1', title: 'Execute command', kind: 'execute' },
        options: [
          { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'allow-always', name: 'Allow always', kind: 'allow_always' },
          { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
        ],
      },
    });

    // Wait for the client to respond before continuing
    await permissionResponse;
    if (this.abort.aborted) return;

    // tool_call_update completed
    emit(out, {
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc_1',
          status: 'completed',
        },
      },
    });

    await sleep(300 * multiplier, this.abort);
    if (this.abort.aborted) return;

    // agent_message_chunks
    const words = [
      'The repository ', 'contains several ', 'TypeScript files ', 'organized in ',
      'a modular ', 'structure. ', 'The main ', 'entry point ', 'is src/index.ts. ',
      'Tests are ', 'powered by ', 'Vitest.',
    ];

    for (const word of words) {
      if (this.abort.aborted) return;
      emit(out, {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: word },
          },
        },
      });
      await sleep(100 * multiplier, this.abort);
    }

    if (this.abort.aborted) return;

    await sleep(200 * multiplier, this.abort);
    if (this.abort.aborted) return;

    // Final response
    emit(out, {
      jsonrpc: '2.0',
      id: 3,
      result: { stopReason: 'end_turn' },
    });

    this.exitCode = 0;
    setImmediate(() => {
      out.push(null); // end stream
      this.emit('exit', 0, null);
    });
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    if (this.killed) return false;
    this.killed = true;
    this.abort.aborted = true;
    this.stdinRl?.close();
    // Resolve any pending stdin waiters so they don't hang
    for (const resolver of this.pendingStdinResolvers) {
      resolver('');
    }
    this.pendingStdinResolvers.length = 0;
    setImmediate(() => {
      this.stdout.push(null);
      this.emit('exit', signal === 'SIGKILL' ? null : 0, signal);
    });
    return true;
  }
}
