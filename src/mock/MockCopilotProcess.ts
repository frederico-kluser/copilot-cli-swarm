import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import type {
  JsonRpcMessage,
  SessionConfigOption,
  SessionConfigValue,
  SessionSetConfigOptionParams,
} from '../acp/types.js';
import {
  cloneSessionConfigOptions,
  flattenSessionConfigOptions,
  getModelConfigOption,
  isSessionSelectConfigOption,
} from '../acp/types.js';

export type MockScenario = 'happy' | 'slow' | 'error' | 'rate_limit';

export interface MockCopilotProcessOptions {
  scenario?: MockScenario;
  seed?: number;
  model?: string;
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
      setTimeout(() => clearInterval(check), ms + 100);
    }
  });
}

function createDefaultConfigOptions(initialModel?: string): SessionConfigOption[] {
  const openAiModels: SessionConfigValue[] = [
    { value: 'gpt-5', name: 'GPT-5', description: 'Balanced and capable' },
    { value: 'gpt-5-mini', name: 'GPT-5 mini', description: 'Fast and efficient' },
  ];
  const anthropicModels: SessionConfigValue[] = [
    { value: 'claude-sonnet-4', name: 'Claude Sonnet 4', description: 'Strong long-context reasoning' },
  ];

  const modelValues = [...openAiModels, ...anthropicModels];
  if (initialModel && !modelValues.some((option) => option.value === initialModel)) {
    modelValues.push({ value: initialModel, name: initialModel, description: 'Custom model' });
  }

  return [
    {
      id: 'mode',
      name: 'Session Mode',
      category: 'mode',
      type: 'select',
      currentValue: 'code',
      options: [
        { value: 'ask', name: 'Ask', description: 'Request permission before changes' },
        { value: 'code', name: 'Code', description: 'Write and modify code directly' },
      ],
    },
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: initialModel ?? 'gpt-5',
      options: [
        { group: 'OpenAI', options: openAiModels },
        { group: 'Anthropic', options: anthropicModels },
        ...(initialModel && ![...openAiModels, ...anthropicModels].some((option) => option.value === initialModel)
          ? [{
              group: 'Custom',
              options: [{ value: initialModel, name: initialModel, description: 'Custom model' }],
            }]
          : []),
      ],
    },
  ];
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
  private readonly sessionId: string;
  private configOptions: SessionConfigOption[];
  private pendingResponseResolvers = new Map<number | string, {
    resolve: (result: unknown) => void;
    reject: (err: Error) => void;
  }>();
  private nextServerRequestId = 100;
  private activePromptAbort: { aborted: boolean } | null = null;

  constructor(opts: MockCopilotProcessOptions = {}) {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.pid = Math.floor(Math.random() * 1e6) + 900000;
    this.sessionId = `mock_sess_${this.pid}`;
    this.configOptions = createDefaultConfigOptions(opts.model);
    this.stdin.on('finish', () => {
      if (!this.killed) {
        this.kill();
      }
    });

    this.stdinRl = createInterface({ input: this.stdin });
    this.stdinRl.on('line', (line) => {
      this.handleLine(line, opts.scenario ?? 'happy');
    });
  }

  private waitForResponse(id: number | string, timeoutMs = 5000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Mock: timeout waiting for client response'));
      }, timeoutMs);

      this.pendingResponseResolvers.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  private handleLine(line: string, scenario: MockScenario): void {
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line) as JsonRpcMessage;
    } catch {
      return;
    }

    const hasId = 'id' in msg && msg.id != null;
    const hasMethod = 'method' in msg && typeof msg.method === 'string';

    if (hasMethod) {
      const req = msg as { id?: number | string; method: string; params?: unknown };
      void this.handleClientRequest(req.id, req.method, req.params, scenario);
      return;
    }

    if (hasId) {
      const resp = msg as { id: number | string; result?: unknown; error?: { message: string } };
      const pending = this.pendingResponseResolvers.get(resp.id);
      if (!pending) {
        return;
      }

      this.pendingResponseResolvers.delete(resp.id);
      if (resp.error) {
        pending.reject(new Error(resp.error.message));
      } else {
        pending.resolve(resp.result);
      }
    }
  }

  private sendResult(id: number | string, result: unknown): void {
    emit(this.stdout, {
      jsonrpc: '2.0',
      id,
      result,
    });
  }

  private sendError(id: number | string, code: number, message: string): void {
    emit(this.stdout, {
      jsonrpc: '2.0',
      id,
      error: { code, message },
    });
  }

  private sendSessionUpdate(update: unknown): void {
    emit(this.stdout, {
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: this.sessionId,
        update,
      },
    });
  }

  private async handleClientRequest(
    id: number | string | undefined,
    method: string,
    params: unknown,
    scenario: MockScenario,
  ): Promise<void> {
    if (this.abort.aborted) {
      return;
    }

    if (method === 'session/cancel') {
      if (this.activePromptAbort) {
        this.activePromptAbort.aborted = true;
      }
      return;
    }

    if (id === undefined) {
      return;
    }

    if (method === 'initialize') {
      this.sendResult(id, { protocolVersion: 1, agentCapabilities: {} });
      return;
    }

    if (method === 'session/new') {
      this.sendResult(id, {
        sessionId: this.sessionId,
        configOptions: cloneSessionConfigOptions(this.configOptions),
      });
      return;
    }

    if (method === 'session/set_config_option') {
      const request = params as SessionSetConfigOptionParams;
      const nextConfigOptions = this.setConfigOption(request);
      if (!nextConfigOptions) {
        this.sendError(id, -32602, `Unknown config option: ${request.configId}`);
        return;
      }

      this.sendResult(id, { configOptions: cloneSessionConfigOptions(nextConfigOptions) });
      this.sendSessionUpdate({
        sessionUpdate: 'config_option_update',
        configOptions: cloneSessionConfigOptions(nextConfigOptions),
      });
      return;
    }

    if (method === 'session/prompt') {
      void this.runScenario(id, scenario);
      return;
    }

    this.sendError(id, -32601, `Method not found: ${method}`);
  }

  private setConfigOption(request: SessionSetConfigOptionParams): SessionConfigOption[] | null {
    const nextConfigOptions = cloneSessionConfigOptions(this.configOptions);
    if (!nextConfigOptions) {
      return null;
    }

    const config = nextConfigOptions.find((option) => option.id === request.configId);
    if (!config) {
      return null;
    }

    if (isSessionSelectConfigOption(config) && typeof request.value === 'string') {
      const allowedValues = flattenSessionConfigOptions(config).map((option) => option.value);
      if (!allowedValues.includes(request.value)) {
        return null;
      }
      config.currentValue = request.value;
    } else if (config.type === 'boolean' && typeof request.value === 'boolean') {
      config.currentValue = request.value;
    } else {
      return null;
    }

    this.configOptions = nextConfigOptions;
    return this.configOptions;
  }

  private async requestPermission(): Promise<void> {
    const id = this.nextServerRequestId++;
    const response = this.waitForResponse(id);

    emit(this.stdout, {
      jsonrpc: '2.0',
      id,
      method: 'session/request_permission',
      params: {
        sessionId: this.sessionId,
        toolCall: { toolCallId: 'tc_1', title: 'Execute command', kind: 'execute' },
        options: [
          { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'allow-always', name: 'Allow always', kind: 'allow_always' },
          { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
        ],
      },
    });

    await response;
  }

  private async runScenario(promptRequestId: number | string, scenario: MockScenario): Promise<void> {
    const out = this.stdout;
    const multiplier = scenario === 'slow' ? 3 : 1;
    const promptAbort = { aborted: false };
    this.activePromptAbort = promptAbort;

    await sleep(10);

    if (this.abort.aborted || promptAbort.aborted) return;

    await sleep(400 * multiplier, promptAbort);
    if (this.abort.aborted || promptAbort.aborted) {
      this.sendResult(promptRequestId, { stopReason: 'cancelled' });
      return;
    }

    this.sendSessionUpdate({
      sessionUpdate: 'agent_thought_chunk',
      content: { text: 'Analyzing the repository structure...' },
    });

    await sleep(500 * multiplier, promptAbort);
    if (this.abort.aborted || promptAbort.aborted) {
      this.sendResult(promptRequestId, { stopReason: 'cancelled' });
      return;
    }

    this.sendSessionUpdate({
      sessionUpdate: 'plan',
      entries: [
        { content: 'Read directory', priority: 'high', status: 'pending' },
        { content: 'Analyze contents', priority: 'high', status: 'pending' },
        { content: 'Generate summary', priority: 'medium', status: 'pending' },
      ],
    });

    await sleep(500 * multiplier, promptAbort);
    if (this.abort.aborted || promptAbort.aborted) {
      this.sendResult(promptRequestId, { stopReason: 'cancelled' });
      return;
    }

    this.sendSessionUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc_1',
      title: 'Execute command',
      kind: 'execute',
      rawInput: { command: 'ls -la' },
    });

    await sleep(1000 * multiplier, promptAbort);
    if (this.abort.aborted || promptAbort.aborted) {
      this.sendResult(promptRequestId, { stopReason: 'cancelled' });
      return;
    }

    if (scenario === 'error') {
      this.sendSessionUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tc_1',
        status: 'failed',
        error: 'Permission denied',
      });
      this.exitCode = 1;
      setImmediate(() => {
        out.push(null);
        this.emit('exit', 1, null);
      });
      return;
    }

    if (scenario === 'rate_limit') {
      this.sendError(promptRequestId, 429, 'rate limit exceeded — too many requests');
      this.exitCode = 1;
      setImmediate(() => {
        out.push(null);
        this.emit('exit', 1, null);
      });
      return;
    }

    await this.requestPermission();
    if (this.abort.aborted || promptAbort.aborted) {
      this.sendResult(promptRequestId, { stopReason: 'cancelled' });
      return;
    }

    this.sendSessionUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc_1',
      status: 'completed',
    });

    await sleep(300 * multiplier, promptAbort);
    if (this.abort.aborted || promptAbort.aborted) {
      this.sendResult(promptRequestId, { stopReason: 'cancelled' });
      return;
    }

    const words = [
      'The repository ', 'contains several ', 'TypeScript files ', 'organized in ',
      'a modular ', 'structure. ', 'The main ', 'entry point ', 'is src/index.ts. ',
      'Tests are ', 'powered by ', 'Vitest.',
    ];

    for (const word of words) {
      if (this.abort.aborted || promptAbort.aborted) {
        this.sendResult(promptRequestId, { stopReason: 'cancelled' });
        return;
      }

      this.sendSessionUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: word },
      });
      await sleep(100 * multiplier, promptAbort);
    }

    if (this.abort.aborted || promptAbort.aborted) {
      this.sendResult(promptRequestId, { stopReason: 'cancelled' });
      return;
    }

    await sleep(200 * multiplier, promptAbort);
    if (this.abort.aborted || promptAbort.aborted) {
      this.sendResult(promptRequestId, { stopReason: 'cancelled' });
      return;
    }

    this.sendResult(promptRequestId, { stopReason: 'end_turn' });

    this.exitCode = 0;
    this.activePromptAbort = null;
    setImmediate(() => {
      out.push(null);
      this.emit('exit', 0, null);
    });
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    if (this.killed) return false;
    this.killed = true;
    this.abort.aborted = true;
    if (this.activePromptAbort) {
      this.activePromptAbort.aborted = true;
    }
    this.stdinRl?.close();
    for (const [, pending] of this.pendingResponseResolvers) {
      pending.reject(new Error('Mock process killed'));
    }
    this.pendingResponseResolvers.clear();
    setImmediate(() => {
      this.stdout.push(null);
      this.emit('exit', signal === 'SIGKILL' ? null : 0, signal);
    });
    return true;
  }
}
