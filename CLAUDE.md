# CLAUDE.md — multi-copilot-orchestrator

Contexto persistente para coding agents. Sempre consulte Skills relevantes em `.claude/skills/` ANTES de iniciar tarefas específicas.

## Projeto

Orquestrador pessoal que spawna N instâncias do GitHub Copilot CLI (`copilot --acp --stdio`) em paralelo, cada uma em sua própria git worktree, com UI em terminal via Ink.

## Stack

- Runtime: Node 22+, TypeScript 5.7, tsx 4.21 (ESM puro, `"type":"module"`)
- UI: ink 6.8, @inkjs/ui 2.0, react 19
- Git: simple-git 3.35 (worktrees via `.raw()` — sem API dedicada)
- Processos: execa 9.6
- Logging: pino 10.3 (destino: arquivo NDJSON, NUNCA stdout)
- Testes: vitest 4.1

## Build & Run

```bash
npm run dev -- "prompt"              # 1 agente real
npm run dev -- -n 3 "a" "b" "c"     # 3 agentes reais
npm run dev:mock -- "test"           # 1 agente mock (sem Copilot)
npm run dev:mock -- -n 3 "a" "b" "c" # 3 agentes mock
npm run typecheck                    # tsc --noEmit
npm run test:run                     # vitest run (todos os testes)
npm run test:watch                   # vitest watch
npm run cleanup                      # remove worktrees órfãs
npm run reap                         # mata processos zumbi
```

## Arquitetura

```
CLI (parseArgs) → Orchestrator → N × AgentSupervisor → ACP JSON-RPC 2.0 (NDJSON/stdio)
                       │                    │                      │
                       │                    ├─ MockCopilotProcess  ├─ copilot --acp --stdio
                       │                    └─ stateChange events  └─ session/update notifications
                       │
                  WorktreeManager            Ink UI
                  (simple-git .raw())        App → StatusBar + AgentGrid → N × AgentPanel
```

O fluxo: `parseCli()` → detecta branch local → `Orchestrator.init()` (prune órfãs) → `launch(tasks)` (cria worktree + AgentSupervisor por task, com stagger 2s) → `render(<App>)` com Ink → `waitForAll()` → shutdown + destroyAll.

## Constraints críticos

- **stdout é sagrado** — Ink renderiza no stdout do processo. Qualquer `console.log`, `process.stdout.write` ou print que vaze para stdout corrompe a UI. Logs vão SEMPRE para arquivo via pino.
- **ACP = JSON-RPC 2.0 sobre NDJSON em stdio** — escrevemos no stdin do child, lemos do stdout do child. Uma linha JSON por mensagem, terminada por `\n`.
- **Rate limit do Copilot é hard-fail** (~10-20 req/min). Stagger de spawn e retry com backoff são obrigatórios com N ≥ 3.
- **simple-git não tem `.worktree()`** — tudo via `.raw('worktree', 'add'|'list'|'remove', ...)`.
- **Imports ESM** — todo import de arquivo local usa extensão `.js` (ex: `'./types.js'`).

## Layout

```
src/
  acp/                  # Tipos ACP (SessionUpdate union) e state machine pura
  agent/                # AgentSupervisor (1 classe = 1 child process) + pids-file
  worktree/             # WorktreeManager (simple-git .raw())
  orchestrator/         # Orchestrator (coordena N supervisors)
  ui/                   # Componentes Ink (App, AgentGrid, AgentPanel, StatusBar)
  logging/              # pino configurado para arquivo NDJSON
  mock/                 # MockCopilotProcess + fake-acp-stream.ts
  cli.ts                # parseArgs nativo (Node 22)
  index.ts              # Entry point (CLI → Orchestrator → Ink)
scripts/
  setup.sh              # Valida pré-requisitos e instala deps
  cleanup-worktrees.ts  # Remove worktrees órfãs
  reap.ts               # Mata processos zumbi via pids.json
```

## Convenções de código

- Functional components com arrow functions (React/Ink)
- Sem `console.log` em código de produção — usar `logger` de `src/logging/logger.ts`
- Sem `any` explícito — usar `unknown` + type guards
- Sem hardcode de secrets — usar variáveis de ambiente
- Validar inputs em boundaries do sistema (args CLI, ACP messages)
- Nomes descritivos em inglês para código
- Imutabilidade: sempre retornar novo objeto em reducers, nunca mutar input

## Convenções de commit

Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`
Commits atômicos (uma mudança lógica por commit).

## Testes

- **phase-machine** (13 testes) — puro, zero I/O, testa todas as transições de estado
- **WorktreeManager** (9 testes) — cria repo git real em `os.tmpdir()`, testa ciclo completo de worktrees, cleanup em afterEach
- Usar `defaultBranch` (detectada via `git.branchLocal()`) em vez de hardcoded `'main'`
- Testes de WorktreeManager geram IDs únicos para evitar colisão entre runs

## Variáveis de ambiente

| Variável | Descrição | Default |
|---|---|---|
| `COPILOT_ORCH_LOG_DIR` | Diretório de logs | `~/.local/share/copilot-orch/logs` |
| `COPILOT_ORCH_LOG_LEVEL` | Nível de log | `info` |
| `COPILOT_ORCH_STAGGER_MS` | Delay entre spawns (ms) | `2000` |

## Skills disponíveis

Consulte `.claude/skills/` para conhecimento procedural sob demanda:
- **architecture-overview** — arquitetura, module boundaries, data flow, EventEmitter patterns
- **acp-protocol** — protocolo ACP, SessionUpdate types, phase machine, config options
- **agent-lifecycle** — AgentSupervisor: spawn, handshake, prompt, rate limit, shutdown
- **orchestrator-coordination** — 3-phase launch, model state, stagger, shutdown coordenado
- **cli-and-entrypoint** — parseArgs, wizard vs direct mode, signal handling, entry point flow
- **worktree-management** — lifecycle de git worktrees com simple-git
- **ink-ui-patterns** — padrões UI Ink 6.8 com React 19, wizard, model selector
- **code-review** — checklist de review para PRs
- **debug-agent-issues** — troubleshooting de agentes (crash, zombie, rate limit)
- **mock-development** — desenvolvimento com mock mode e cenários
- **testing-patterns** — vitest, factories, real git repos, E2E scripts
- **add-new-feature** — workflow step-by-step para adicionar features
