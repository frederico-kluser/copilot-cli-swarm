---
name: agent-lifecycle
description: >-
  AgentSupervisor lifecycle: spawn, ACP handshake, prompt execution, rate
  limit retry with backoff, model switching, permission handling, and
  graceful shutdown. Use when modifying agent process management or ACP flow.
---
# Agent Lifecycle — AgentSupervisor internals

## Visão geral

`AgentSupervisor` (em `src/agent/AgentSupervisor.ts`) gerencia o ciclo de vida completo de um child process Copilot CLI. Uma instância = um processo = uma worktree.

## Ciclo de vida completo

```
constructor(opts)
     │
     ▼
  start()
     │
     ├── Spawn child process (execa ou MockCopilotProcess)
     ├── Setup NDJSON line reader no stdout do child
     ├── Setup stderr buffer (rolling 4KB)
     ├── Setup exit handler
     │
     ├── sendRequest('initialize', {protocolVersion: 1})
     │     └── Response: {protocolVersion, agentCapabilities}
     │
     ├── sendRequest('session/new', {cwd, mcpServers: []})
     │     └── Response: {sessionId, configOptions?}
     │
     └── state → 'idle', emit 'stateChange'
          │
          ▼
     prompt(text)
          │
          ├── Reset state (lastMessage='', lastThought='', currentTool=null)
          ├── sendRequest('session/prompt', {sessionId, prompt: [{type:'text', text}]})
          │
          │   ◄── N × session/update notifications (NDJSON)
          │       │
          │       ├── agent_thought_chunk → state.lastThought += text, phase → 'thinking'
          │       ├── plan → state.plan = entries[], phase → 'planning'
          │       ├── tool_call → state.currentTool = {id, title, status}, phase → 'tool_call'
          │       ├── tool_call_update → atualiza currentTool.status ou phase → 'error'
          │       ├── agent_message_chunk → state.lastMessage += text, phase → 'responding'
          │       ├── config_option_update → atualiza configOptions/model (NÃO muda phase)
          │       └── confirmation_request → (não implementado atualmente)
          │
          │   ◄── Response: {stopReason: 'end_turn'}
          │
          └── state → 'done', emit 'stateChange', emit 'done'
               │
               ▼
          shutdown()
               │
               ├── Set isShuttingDown = true
               ├── Abort shutdown controller (cancela rate limit sleeps)
               ├── stdin.end() → graceful close
               ├── Wait 2s para exit voluntário
               ├── SIGTERM se ainda vivo
               ├── Wait 2s
               ├── SIGKILL se ainda vivo
               ├── Reject todos pending JSON-RPC requests
               └── Log 'Agent shut down'
```

## ACP Handshake detalhado

```typescript
// Fase 1: Initialize
await this.sendRequest('initialize', {
  protocolVersion: 1,
  clientCapabilities: {},
});

// Fase 2: Create Session
const sessionResult = await this.sendRequest('session/new', {
  cwd: this.opts.cwd,
  mcpServers: [],
}) as SessionNewResult;

this.sessionId = sessionResult.sessionId;
// configOptions pode vir aqui — contém modelo disponível, etc.
this.state = withConfigOptions({ ...this.state, phase: 'idle' }, sessionResult.configOptions);
```

## JSON-RPC Message Routing

O `handleLine()` classifica cada linha NDJSON em 3 categorias:

| Condição | Tipo | Ação |
|---|---|---|
| Tem `id` E `method` | Request do agent | `handleServerRequest()` (ex: permission) |
| Tem `id`, sem `method` | Response | Resolve/reject do `pendingRequests` Map |
| Sem `id`, tem `method` | Notification | Se `session/update` → `reduceAgentState()` |

Correlation Map:
```typescript
private pendingRequests = new Map<number | string, {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}>();
```

Todos os pending são rejeitados com `new Error('shutdown')` ou com a mensagem de erro do exit event.

## Rate Limit e Retry

Detecção via 4 regex patterns no erro:
```typescript
const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /\b429\b/,
  /quota.*exceeded/i,
  /too many requests/i,
];
```

Backoff schedule: `[60_000, 120_000, 300_000]` ms (1min, 2min, 5min).

Cada retry aplica jitter de ±10%: `Math.round(ms * (0.9 + Math.random() * 0.2))`.

Máximo 3 retries. O 4º falha propagando o erro original.

O backoff sleep é cancelável via `AbortSignal` do `shutdownController`. Se shutdown durante backoff, o prompt lança `Error('Shutdown during rate limit backoff')`.

UI feedback durante rate limit:
```typescript
this.state = {
  ...this.state,
  phase: 'rate_limited',
  retryCount: attempt + 1,
  retryResumeAt: Date.now() + waitMs,  // timestamp absoluto
};
this.emit('stateChange', this.state);
```

## Permission Handling (request_permission)

Quando o agent pede permissão para executar uma tool:

```typescript
handleServerRequest(id, 'session/request_permission', params) {
  const options: PermissionOption[] = params.options;
  // Busca allow_always primeiro, depois allow_once como fallback
  const allowOption = options.find(o => o.kind === 'allow_always')
    ?? options.find(o => o.kind === 'allow_once');
  // Auto-approve
  this.sendResponse(id, { outcome: { outcome: 'selected', optionId: allowOption.optionId } });
}
```

Na prática, o Copilot CLI auto-aprova tool calls (Issue #845), então esse handler raramente é acionado. Mas DEVE existir no contrato ACP.

## Model Switching

```typescript
async setModel(model: string): Promise<void> {
  // Valida: sessão ativa, modelo existe na lista disponível
  const result = await this.sendRequest('session/set_config_option', {
    sessionId: this.sessionId,
    configId: modelConfig.id,   // geralmente 'model'
    value: model,
  }) as SessionSetConfigOptionResult;

  // Atualiza state com novos configOptions
  this.state = withConfigOptions(this.state, result.configOptions);
  this.emit('stateChange', this.state);
}
```

## Command Args Building

```typescript
function buildCommandArgs(opts: AgentSupervisorOptions): string[] {
  const args = opts.args ?? ['--acp', '--stdio', '--allow-all-tools'];
  if (opts.model && !args.some(a => a === '--model' || a.startsWith('--model='))) {
    args.push('--model', opts.model);
  }
  return args;
}
```

O `--allow-all-tools` é default porque o orquestrador auto-aprova permissões.

## ChildLike interface (duck typing)

```typescript
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
```

Tanto `execa()` child quanto `MockCopilotProcess` satisfazem esta interface. O supervisor não precisa saber qual é.

## Shutdown sequence detalhada

```
isShuttingDown = true
shutdownController.abort()     ← cancela rate limit sleeps
     │
stdin.end()                    ← sinaliza EOF para o child
     │
     ├── Wait 2s ─── Child saiu? → OK
     │                    │
     │                    └── Não → SIGTERM
     │                              │
     │                              ├── Wait 2s ─── Child saiu? → OK
     │                              │                    │
     │                              │                    └── Não → SIGKILL
     │
Reject todos pendingRequests com Error('shutdown')
Clear Map
Log 'Agent shut down'
```

O `cancel()` method é separado: envia `session/cancel` via JSON-RPC SEM matar o processo. Usado pelo Orchestrator antes do shutdown forçado.

## PID Tracking (`src/agent/pids-file.ts`)

```typescript
interface PidEntry { pid: number; agentId: string; spawnedAt: number; parentPid: number; }
```

- `readPids()` → lê `~/.local/state/copilot-orch/pids.json`
- `addPid(entry)` → append ao array
- `removePid(pid)` → filter
- `clearAll()` → reset para `[]`
- `isProcessAlive(pid)` → `process.kill(pid, 0)` (signal 0 = check sem matar)

No startup (`index.ts`), `reapStalePids()` mata PIDs cujo `parentPid` não está mais vivo.

## Gotchas

- **stderr buffer é rolling 4KB.** `this.stderrBuf` acumula e trunca. As últimas 3 linhas do stderr são incluídas na mensagem de erro quando o child morre.
- **exitPromise.** Criada no `start()` como `new Promise(resolve => { this.exitResolve = resolve })`. Resolvida no handler de `'exit'`. Usada por `waitForExit()` e pelo shutdown.
- **Exit com phase 'done'.** Se o child sai e a phase já é `'done'`, é tratado como sucesso (sem emit de error).
- **Mock PIDs.** MockCopilotProcess gera PIDs falsos (900000+). `isProcessAlive()` retorna false para esses, então o reaper os ignora.
- **Pending requests na saída.** Quando o child morre, TODOS os pending são rejeitados com a mensagem de erro do exit.
- **prompt() é single-flight.** Um supervisor só processa um prompt por vez. O Orchestrator garante que `prompt()` é chamado uma vez por supervisor.
