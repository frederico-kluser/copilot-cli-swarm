---
name: acp-protocol
description: >-
  ACP JSON-RPC 2.0 protocol over NDJSON stdio, SessionUpdate discriminated
  union, phase machine transitions, type guards, and mock scenarios. Use when
  working with ACP messages, agent state, or the phase-machine module.
---
# ACP Protocol — Agent Client Protocol internals

## Wire format

ACP usa JSON-RPC 2.0 sobre NDJSON (uma linha JSON por mensagem, terminada por `\n`) em stdio do child process `copilot --acp --stdio`.

```
Orchestrator (parent)                 Copilot CLI (child)
       │                                     │
       ├─ stdin ──── Request ───────────────►│
       │              {jsonrpc:"2.0", id:1,  │
       │               method:"initialize"} │
       │                                     │
       │◄──── Response ──────── stdout ──────┤
       │  {jsonrpc:"2.0", id:1, result:{…}} │
       │                                     │
       │◄──── Notification ──── stdout ──────┤
       │  {jsonrpc:"2.0",                    │
       │   method:"session/update",          │
       │   params:{update:{sessionUpdate:…}}}│
       └─────────────────────────────────────┘
```

**Request** = tem `id` + `method` + `params` (client → agent).
**Response** = tem `id` + `result` ou `error` (agent → client, correlaciona com request).
**Notification** = tem `method` mas NÃO tem `id` (agent → client, fire-and-forget).

## Sequência de sessão

1. `initialize` → response com `protocolVersion`, `agentCapabilities`
2. `session/new` → response com `sessionId`
3. `session/prompt` → dispara execução, seguida de N notifications `session/update`, finaliza com response `{stopReason}`

## SessionUpdate — discriminated union

O campo discriminador é `sessionUpdate` (string) dentro de `params.update`. Tipos implementados em `src/acp/types.ts`:

| sessionUpdate | Dados principais | Fase resultante |
|---|---|---|
| `agent_thought_chunk` | `content.text` | `thinking` |
| `plan` | `entries[]` com content/priority/status | `planning` |
| `tool_call` | `toolCallId`, `title`, `kind`, `rawInput` | `tool_call` |
| `tool_call_update` | `toolCallId`, `status` | `tool_call` ou `error` |
| `agent_message_chunk` | `content.type`, `content.text` | `responding` |
| `confirmation_request` | `toolCallId`, `title`, `message` | (não transita) |
| `config_option_update` | `configOptions[]` | (não transita fase) |

## ConfigOptionUpdate e Model metadata

O `config_option_update` é especial: **não transita fase**. Passa direto em `reducePhase()` e atualiza apenas metadata de modelo. Inclusive `done` e `error` (estados absorventes) aceitam `config_option_update`.

### SessionConfigOption — discriminated union por `type`

```typescript
type SessionConfigOption =
  | SessionSelectConfigOption    // type: 'select' (model selector, mode selector)
  | SessionBooleanConfigOption   // type: 'boolean'
  | SessionUnknownConfigOption;  // type: string (fallback)

interface SessionSelectConfigOption {
  id: string;             // ex: 'model', 'mode'
  name: string;           // ex: 'Model', 'Session Mode'
  category?: string;      // ex: 'model' (usado para detectar o seletor de modelo)
  type: 'select';
  currentValue: string;
  options: SessionConfigSelectOptionEntry[];  // podem ser flat ou agrupados
}

type SessionConfigSelectOptionEntry = SessionConfigValue | SessionConfigValueGroup;

interface SessionConfigValue { value: string; name: string; description?: string; }
interface SessionConfigValueGroup { group: string; options: SessionConfigValue[]; }
```

### Helpers de modelo em `src/acp/types.ts`

| Função | Input | Output | Uso |
|---|---|---|---|
| `getModelConfigOption(configOptions)` | `SessionConfigOption[] \| null` | `SessionSelectConfigOption \| null` | Primeira opção select com category 'model', id 'model'/'models', ou name 'Model' |
| `getAvailableModels(configOptions)` | `SessionConfigOption[] \| null` | `SessionConfigValue[]` | Flatten de todas values/groups do model option |
| `getCurrentModel(configOptions)` | `SessionConfigOption[] \| null` | `string \| null` | `currentValue` da model option |
| `getCurrentModelLabel(configOptions)` | `SessionConfigOption[] \| null` | `string \| null` | `name` do model cujo value === currentValue |
| `flattenSessionConfigOptions(option)` | `SessionSelectConfigOption` | `SessionConfigValue[]` | Flatten groups em array plano de values |
| `cloneSessionConfigOptions(opts)` | `SessionConfigOption[] \| null` | `SessionConfigOption[] \| null` | Deep clone para imutabilidade |

### withConfigOptions() em phase-machine.ts

```typescript
function withConfigOptions(state: AgentState, configOptions?: SessionConfigOption[] | null): AgentState {
  const nextConfigOptions = cloneSessionConfigOptions(configOptions);
  return {
    ...state,
    configOptions: nextConfigOptions,
    currentModel: getCurrentModel(nextConfigOptions),
    currentModelLabel: getCurrentModelLabel(nextConfigOptions),
  };
}
```

### ACP Response types

```typescript
interface SessionNewResult { sessionId: string; configOptions?: SessionConfigOption[]; }
interface SessionPromptResult { stopReason?: string; }
interface SessionSetConfigOptionResult { configOptions?: SessionConfigOption[]; }
```

## Type guards

```typescript
import {
  isAgentThoughtChunk,
  isAgentMessageChunk,
  isToolCall,
  isToolCallUpdate,
  isPlan,
  isConfirmationRequest,
  isConfigOptionUpdate,
  isSessionConfigValueGroup,
  isSessionSelectConfigOption,
} from '../acp/types.js';
```

Cada guard verifica `u.sessionUpdate === 'nome_do_tipo'`. Sempre prefira type guards a casts manuais.

## Phase machine (`src/acp/phase-machine.ts`)

State machine pura (zero I/O, zero async, zero Date.now). Funções:

- `reducePhase(current, update)` — retorna próxima `AgentPhase`
- `reduceAgentState(state, update)` — retorna novo `AgentState` completo
- `resetState()` — retorna `initialState` fresh
- `initialState` — constante com phase `'spawning'`

### AgentState shape

```typescript
interface AgentState {
  phase: AgentPhase;        // spawning|idle|thinking|planning|tool_call|responding|done|error|rate_limited
  lastMessage: string;      // acumulado de agent_message_chunk
  lastThought: string;      // acumulado de agent_thought_chunk
  currentTool: { id: string; title: string; status: string } | null;
  plan: PlanEntry[] | null;
  configOptions: SessionConfigOption[] | null;  // metadata de modelo/modo
  currentModel: string | null;                  // value do modelo ativo
  currentModelLabel: string | null;             // display name do modelo ativo
  error: string | null;
  retryCount: number;
  retryResumeAt: number | null;
}
```

### Regras de transição

- `done` e `error` são **estados absorventes** — não transitam para nada. Retornam estado inalterado. **Exceção:** `config_option_update` é processado mesmo em estados absorventes (refresh de modelo).
- `config_option_update` **nunca transita fase**. Atualiza apenas `configOptions`, `currentModel`, `currentModelLabel`.
- `tool_call_update` com `status === 'failed'` força `phase: 'error'` com mensagem.
- Chunks de pensamento e mensagem **acumulam** (concatenação, não substituição).
- Plan entries são **copiados** (deep copy via spread), nunca referenciados.
- `rate_limited` é ativado pelo AgentSupervisor (não pela phase machine) quando detecta rate limit.

## Gotchas

- **stdout é sagrado.** O stdout do processo Node é exclusivo do Ink. ACP streams usam o stdout do *child process*, não do parent. Nunca confundir os dois.
- **requestPermission nunca é chamado.** O handler existe no contrato ACP mas o Copilot CLI auto-aprova tool calls (Issue #845). Não dependa dele para gating de segurança.
- **Rate limit é heurístico.** Detecção via regex em mensagens de erro: `/rate.?limit/i`, `/\b429\b/`, `/quota.*exceeded/i`, `/too many requests/i`. Não há código de erro padronizado no ACP.
- **Backoff com jitter.** 60s/120s/300s com ±10% de jitter. Máximo 3 retries. Sleep cancelável via AbortSignal do shutdown.
- **JSON-RPC id correlação.** `AgentSupervisor` mantém um `Map<id, {resolve, reject}>` para correlacionar responses com requests pendentes. Na saída do child process, todos os pending são rejeitados.
- **Mock vs Real.** `MockCopilotProcess` emite o mesmo formato NDJSON que o Copilot real. A interface é duck-typed (stdin/stdout/stderr/kill/on('exit')). O AgentSupervisor não precisa de `if (mock)` espalhado.
