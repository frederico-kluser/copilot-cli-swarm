import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { reduceAgentState, initialState, type AgentState } from '../acp/phase-machine.js';
import type { SessionUpdate, JsonRpcMessage } from '../acp/types.js';
import { createAgentLogger } from '../logging/logger.js';
import { MockCopilotProcess, type MockScenario } from '../mock/MockCopilotProcess.js';
import type { Logger } from 'pino';

export interface AgentSupervisorOptions {
  id: string;
  cwd: string;
  command?: string;
  args?: string[];
  mock?: boolean;
  mockScenario?: MockScenario;
}

export type AgentSupervisorEvents = {
  stateChange: [state: AgentState];
  done: [stopReason: string];
  error: [err: Error];
};

interface ChildLike {
  stdin: Writable | null;
  stdout: Readable | null;
  stderr: Readable | null;
  pid: number | undefined;
  killed: boolean;
  kill: (signal?: NodeJS.Signals) => boolean;
  on: (event: string, handler: (...args: unknown[]) => void) => unknown;
  removeAllListeners?: (event?: string) => unknown;
}

const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /\b429\b/,
  /quota.*exceeded/i,
  /too many requests/i,
];

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return RATE_LIMIT_PATTERNS.some((re) => re.test(msg));
}

const BACKOFFS_MS = [60_000, 120_000, 300_000];

function withJitter(ms: number): number {
  return Math.round(ms * (0.9 + Math.random() * 0.2));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export class AgentSupervisor extends EventEmitter<AgentSupervisorEvents> {
  readonly id: string;
  state: AgentState = { ...initialState };
  private child: ChildLike | null = null;
  private readonly opts: AgentSupervisorOptions;
  private readonly log: Logger;
  private sessionId: string | null = null;
  private stderrBuf = '';
  private exitPromise: Promise<void> | null = null;
  private exitResolve: (() => void) | null = null;
  private lastPromptText = '';
  private shutdownController = new AbortController();
  private jsonRpcId = 0;
  private pendingRequests = new Map<number | string, {
    resolve: (result: unknown) => void;
    reject: (err: Error) => void;
  }>();

  constructor(opts: AgentSupervisorOptions) {
    super();
    this.id = opts.id;
    this.opts = opts;
    this.log = createAgentLogger(opts.id);
  }

  async start(): Promise<void> {
    this.state = { ...initialState };
    this.emit('stateChange', this.state);

    this.exitPromise = new Promise<void>((resolve) => {
      this.exitResolve = resolve;
    });

    if (this.opts.mock) {
      const mock = new MockCopilotProcess({ scenario: this.opts.mockScenario });
      this.child = mock;
    } else {
      const { execa } = await import('execa');
      const child = execa(this.opts.command ?? 'copilot', this.opts.args ?? ['--acp', '--stdio'], {
        cwd: this.opts.cwd,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        reject: false,
      });
      this.child = child as unknown as ChildLike;
    }

    // Capture stderr
    this.child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrBuf += chunk.toString('utf8');
      if (this.stderrBuf.length > 4096) this.stderrBuf = this.stderrBuf.slice(-4096);
    });

    // Handle exit
    this.child.on('exit', (code: unknown, signal: unknown) => {
      if (this.state.phase === 'done') {
        this.exitResolve?.();
        return;
      }
      const reason = signal
        ? `signal ${String(signal)}`
        : code !== 0
          ? `exit ${String(code)}`
          : 'unexpected exit';
      const lastStderr = this.stderrBuf
        .split('\n')
        .filter(Boolean)
        .slice(-3)
        .join(' | ');
      this.state = {
        ...this.state,
        phase: 'error',
        error: `${reason}${lastStderr ? ' — ' + lastStderr : ''}`,
      };
      this.emit('stateChange', this.state);
      this.emit('error', new Error(this.state.error!));
      // Reject all pending requests
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error(this.state.error!));
      }
      this.pendingRequests.clear();
      this.exitResolve?.();
    });

    // Set up NDJSON line reader on stdout
    if (this.child.stdout) {
      const rl = createInterface({ input: this.child.stdout });
      rl.on('line', (line) => {
        this.handleLine(line);
      });
    }

    this.log.info({ event: 'spawned', pid: this.child.pid }, 'Agent process spawned');

    // Wait for initialize and session/new via our NDJSON protocol
    try {
      await this.sendRequest('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      });

      const sessionResult = await this.sendRequest('session/new', {
        cwd: this.opts.cwd,
        mcpServers: [],
      }) as { sessionId: string };

      this.sessionId = sessionResult.sessionId;

      this.state = { ...this.state, phase: 'idle' };
      this.emit('stateChange', this.state);
      this.log.info({ event: 'ready', sessionId: this.sessionId }, 'Agent ready');
    } catch (err) {
      this.state = {
        ...this.state,
        phase: 'error',
        error: `initialize failed: ${(err as Error).message}`,
      };
      this.emit('stateChange', this.state);
      throw err;
    }
  }

  private handleLine(line: string): void {
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.log.warn({ line }, 'Unparseable NDJSON line');
      return;
    }

    // Response (has id, has result or error)
    if ('id' in msg && msg.id != null) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        if ('error' in msg && msg.error) {
          pending.reject(new Error(msg.error.message));
        } else {
          pending.resolve('result' in msg ? msg.result : undefined);
        }
      }
      return;
    }

    // Notification (no id, has method)
    if ('method' in msg && msg.method === 'session/update') {
      const params = msg.params as { sessionId: string; update: SessionUpdate };
      if (params?.update) {
        this.state = reduceAgentState(this.state, params.update);
        this.emit('stateChange', this.state);
      }
    }
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    const id = ++this.jsonRpcId;
    const msg = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      try {
        this.child?.stdin?.write(JSON.stringify(msg) + '\n');
      } catch (err) {
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  async prompt(text: string): Promise<string> {
    this.lastPromptText = text;
    for (let attempt = 0; attempt <= BACKOFFS_MS.length; attempt++) {
      try {
        return await this.doPrompt(text);
      } catch (err) {
        if (!isRateLimitError(err) || attempt === BACKOFFS_MS.length) {
          throw err;
        }
        const backoff = BACKOFFS_MS[attempt]!;
        const waitMs = withJitter(backoff);
        const resumeAt = Date.now() + waitMs;
        this.state = {
          ...this.state,
          phase: 'rate_limited',
          retryCount: attempt + 1,
          retryResumeAt: resumeAt,
        };
        this.emit('stateChange', this.state);
        this.log.warn(
          { event: 'rate_limited', attempt: attempt + 1, waitMs },
          'Rate limited, backing off',
        );
        await sleep(waitMs, this.shutdownController.signal);
        if (this.shutdownController.signal.aborted) {
          throw new Error('Shutdown during rate limit backoff');
        }
      }
    }
    throw new Error('unreachable');
  }

  private async doPrompt(text: string): Promise<string> {
    // Reset message accumulation
    this.state = {
      ...this.state,
      lastMessage: '',
      lastThought: '',
      currentTool: null,
      plan: null,
      error: null,
      retryCount: 0,
      retryResumeAt: null,
    };

    const result = await this.sendRequest('session/prompt', {
      sessionId: this.sessionId,
      prompt: [{ type: 'text', text }],
    }) as { stopReason?: string };

    const stopReason = result?.stopReason ?? 'end_turn';
    this.state = { ...this.state, phase: 'done', retryCount: 0, retryResumeAt: null };
    this.emit('stateChange', this.state);
    this.emit('done', stopReason);
    return stopReason;
  }

  async cancel(): Promise<void> {
    if (!this.child || this.child.killed) return;
    try {
      this.child.stdin?.write(
        JSON.stringify({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: this.sessionId } }) + '\n',
      );
    } catch {
      // ignore
    }
  }

  async waitForExit(): Promise<void> {
    if (!this.child || this.child.killed) return;
    await this.exitPromise;
  }

  async shutdown(): Promise<void> {
    this.shutdownController.abort();
    if (!this.child || this.child.killed) return;

    try { this.child.stdin?.end?.(); } catch { /* ignore */ }

    const killed = await Promise.race([
      this.waitForExit().then(() => true),
      sleep(2000).then(() => false),
    ]);

    if (!killed && this.child && !this.child.killed) {
      try { this.child.kill('SIGTERM'); } catch { /* ignore */ }
      await Promise.race([
        this.waitForExit(),
        sleep(2000),
      ]);
    }

    if (this.child && !this.child.killed) {
      try { this.child.kill('SIGKILL'); } catch { /* ignore */ }
    }

    // Clean up pending requests
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('shutdown'));
    }
    this.pendingRequests.clear();

    this.log.info({ event: 'shutdown' }, 'Agent shut down');
  }
}
