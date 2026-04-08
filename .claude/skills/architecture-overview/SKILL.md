---
name: architecture-overview
description: >-
  Project architecture, module boundaries, dependency rules, data flow from
  CLI to Copilot and back to UI, EventEmitter patterns. Use when understanding
  codebase structure, planning cross-module changes, or onboarding.
---
# Architecture Overview — multi-copilot-orchestrator

## O que o projeto faz

Um único processo Node.js que spawna N instâncias do GitHub Copilot CLI (`copilot --acp --stdio`) em paralelo, cada uma em sua própria git worktree, com UI em terminal via Ink mostrando streaming em tempo real.

## Diagrama de fluxo

```
CLI (parseArgs)
  │
  ├── --list-models → spawn 1 agent → print models → exit
  │
  ├── interactive (sem prompts) → WizardScreen UI → WizardConfig
  │                                                     │
  └── direct (com prompts) ─────────────────────────────┘
                                                         │
                                                         ▼
                                              Orchestrator.init()
                                                (prune worktrees órfãs)
                                                         │
                                                         ▼
                                              Orchestrator.launch(tasks)
                                                         │
                           ┌─────────────────────────────┼─────────────────────────────┐
                           ▼                             ▼                             ▼
                    AgentSupervisor #1           AgentSupervisor #2           AgentSupervisor #N
                           │                             │                             │
                    WorktreeManager.create()     WorktreeManager.create()     WorktreeManager.create()
                           │                             │                             │
                    copilot --acp --stdio        copilot --acp --stdio        copilot --acp --stdio
                    (ou MockCopilotProcess)      (ou MockCopilotProcess)      (ou MockCopilotProcess)
                           │                             │                             │
                    ACP JSON-RPC 2.0             ACP JSON-RPC 2.0             ACP JSON-RPC 2.0
                    sobre NDJSON/stdio           sobre NDJSON/stdio           sobre NDJSON/stdio
                           │                             │                             │
                           └─────────────────────────────┼─────────────────────────────┘
                                                         │
                                                         ▼
                                                    Ink UI (stdout)
                                              App → StatusBar + AgentGrid
                                                     → N × AgentPanel
```

## Módulos e regras de dependência

```
src/
  cli.ts                  ← parseArgs nativo, zero imports internos exceto types
  index.ts                ← entry point, importa tudo, wires modules together

  acp/                    ← ZERO dependências internas. Puro, testável, sem I/O.
    types.ts              ← Tipos ACP, type guards, config helpers
    phase-machine.ts      ← State machine pura (reduceAgentState)

  agent/                  ← Depende de: acp/, logging/, mock/
    AgentSupervisor.ts    ← 1 classe = 1 child process Copilot
    pids-file.ts          ← Tracking de PIDs em disco (zero deps internas)

  worktree/               ← Depende de: logging/
    WorktreeManager.ts    ← CRUD de git worktrees via simple-git .raw()

  orchestrator/           ← Depende de: agent/, worktree/, logging/, acp/ (tipos)
    Orchestrator.ts       ← Coordena N supervisors, model state, shutdown

  ui/                     ← Depende de: agent/ (AgentSupervisor), orchestrator/, acp/ (tipos), logging/
    App.tsx               ← Root component (wizard ou running mode)
    AgentGrid.tsx         ← Grid responsivo de N painéis
    AgentPanel.tsx        ← Painel individual por agente (memo)
    StatusBar.tsx         ← Barra de status + footer
    useAgentState.ts      ← Hook: useSyncExternalStore sobre supervisor.state
    useOrchestratorModelState.ts  ← Hook: modelo global
    useOrchestratorSupervisors.ts ← Hook: lista de supervisors reactiva
    wizard/               ← UI de configuração interativa
      WizardScreen.tsx    ← Steps de configuração (agents, model, prompts)
      types.ts            ← WizardConfig, WizardStep, ModelOption

  logging/                ← ZERO dependências internas. pino → arquivo NDJSON.
    logger.ts

  mock/                   ← Depende de: acp/ (tipos apenas)
    MockCopilotProcess.ts ← Emula Copilot via PassThrough streams
    fake-acp-stream.ts    ← Script standalone para debug manual

scripts/                  ← Utilitários de manutenção
  cleanup-worktrees.ts    ← Remove worktrees órfãs
  reap.ts                 ← Mata processos zumbi
  setup.sh                ← Valida pré-requisitos + npm ci
  collect-diagnostics.sh  ← Coleta estado para debugging
```

### Regras de dependência (INVIOLÁVEIS)

- `acp/` → **zero imports internos**. Módulo puro, testável isoladamente.
- `logging/` → **zero imports internos**. Singleton exporta `logger` e `createAgentLogger()`.
- `worktree/` → importa apenas `logging/`.
- `agent/` → importa `acp/`, `logging/`, `mock/`. Nunca importa `orchestrator/` ou `ui/`.
- `orchestrator/` → importa `agent/`, `worktree/`, `logging/`, `acp/` (tipos). Nunca importa `ui/`.
- `ui/` → importa `agent/`, `orchestrator/`, `acp/`, `logging/`. É a camada de apresentação.
- `mock/` → importa apenas `acp/` (tipos). Duck-typed para ser drop-in replacement do child process.

## Padrão EventEmitter

### Orchestrator emite:
- `'agentAdded'` (supervisor: AgentSupervisor) — quando um supervisor é criado e registrado
- `'modelStateChange'` (state: OrchestratorModelState) — quando modelo global muda

### AgentSupervisor emite:
- `'stateChange'` (state: AgentState) — a cada SessionUpdate do ACP ou mudança interna
- `'done'` (stopReason: string) — quando prompt completa
- `'error'` (err: Error) — quando child process morre inesperadamente

### Padrão de consumo na UI:
```typescript
// Hooks usam useSyncExternalStore (não useState+useEffect)
const state = useAgentState(supervisor);           // subscreve em 'stateChange'
const modelState = useOrchestratorModelState(orch); // subscreve em 'modelStateChange'
const supervisors = useOrchestratorSupervisors(orch); // subscreve em 'agentAdded'
```

## Data flow: prompt do usuário → resultado na UI

1. Usuário fornece prompt via CLI args ou wizard interativo
2. `index.ts` cria `AgentTask[]` com id + prompt + model opcional
3. `Orchestrator.launch(tasks)` cria worktree + AgentSupervisor por task
4. `AgentSupervisor.start()` spawna child process, faz handshake ACP (initialize → session/new)
5. `AgentSupervisor.prompt(text)` envia `session/prompt` via JSON-RPC
6. Child emite `session/update` notifications com `SessionUpdate` discriminated union
7. `AgentSupervisor.handleLine()` parseia NDJSON, chama `reduceAgentState()`
8. `supervisor.state` é atualizado, emite `'stateChange'`
9. `useAgentState(supervisor)` via `useSyncExternalStore` dispara re-render do `AgentPanel`
10. Ink renderiza o novo estado no terminal (stdout)

## Gotchas arquiteturais

- **stdout é sagrado.** Ink é o único consumidor de `process.stdout`. Qualquer `console.log`, `process.stdout.write`, ou pino write para stdout corrompe a UI. Logs vão SEMPRE para arquivo via pino. Para output legítimo fora da UI (help, error fatal), usar `process.stderr.write()`.
- **Imports ESM com extensão .js.** Todo import de arquivo local usa extensão `.js` (ex: `'./types.js'`), mesmo que o arquivo fonte seja `.ts`. Exigido pelo `"module": "NodeNext"` do tsconfig.
- **Mock é duck-typed.** `MockCopilotProcess` expõe a mesma interface que um child process execa (stdin/stdout/stderr/pid/killed/kill/on). O `AgentSupervisor` não tem nenhum `if (mock)` — a abstração é transparente.
- **Phase machine é pura.** `reduceAgentState()` é função pura: sem I/O, sem async, sem Date.now, sem aleatoriedade. Todo side effect (rate limit timers, process spawn) vive no AgentSupervisor.
- **WorktreeManager usa .raw().** simple-git não tem API dedicada para worktrees. Tudo é `git.raw(['worktree', 'add'|'list'|'remove', ...])`.
- **Max 6 agentes.** Limite hard-coded no Orchestrator. Rate limit do Copilot (~10-20 req/min) torna N>6 impraticável.
