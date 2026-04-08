# multi-copilot-orchestrator

Orquestrador pessoal para rodar N instâncias do GitHub Copilot CLI em paralelo,
cada uma em sua própria git worktree, com UI em terminal via Ink.

## Requisitos

- Node.js 22+
- Git 2.5+ (suporte a worktrees)
- `@github/copilot` instalado globalmente e autenticado (`copilot auth`)
- Linux, macOS, ou WSL

## Setup

```bash
git clone <repo>
cd multi-copilot-orchestrator
./scripts/setup.sh
npm run dev:mock -- "hello"    # valida setup sem gastar rate limit
```

## Uso

```bash
# 1 agente
npm run dev -- "refactor the auth module"

# 1 prompt replicado para 4 agentes
npm run dev -- -n 4 "Create a file called index.txt with the text hello world inside"

# 3 agentes em paralelo
npm run dev -- -n 3 "task 1" "task 2" "task 3"

# Modo mock (sem Copilot real)
npm run dev:mock -- -n 2 "a" "b"

# Mock com cenários específicos
npm run dev:mock:error -- "test"
npm run dev:mock:slow -- "test"

# Com tmux para detach/reattach
tmux new-session -s orch "npm run dev -- 'long task'"
```

## Flags

| Flag | Default | Descrição |
|---|---|---|
| `-n, --agents` | `prompts.length` | Número de agentes |
| `--mock` | false | Usa mock ACP em vez de Copilot real |
| `--mock-scenario` | happy | happy, slow, error, rate_limit |
| `--log-level` | info | debug, info, warn, error |
| `-h, --help` | — | Mostra ajuda |

## Arquitetura

```
┌─ tmux session (opcional, wrapper) ────────────────────┐
│  ┌─ Node (1 processo) ──────────────────────────────┐ │
│  │  Ink render -> stdout                            │ │
│  │  Orchestrator                                    │ │
│  │   ├─ WorktreeManager -> git worktree add/remove  │ │
│  │   ├─ AgentSupervisor[0] ─ stdio ─┐              │ │
│  │   ├─ AgentSupervisor[1] ─ stdio ─┤              │ │
│  │   └─ AgentSupervisor[N] ─ stdio ─┤              │ │
│  │                                   v              │ │
│  │                            copilot --acp --stdio │ │
│  │                             (1 por agente, cwd = │ │
│  │                              worktree respectiva)│ │
│  └──────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────┘
```

## Troubleshooting

### "rate limited, retry 1/3 in 58s"
Esperado quando N >= 3. Aguarde ou reduza N.

### Worktrees não são limpos após crash
```bash
npm run cleanup
```

### Processos zumbi após kill -9
```bash
npm run reap
```

### UI com flicker ou layout quebrado
Alguma parte do código vazou print no stdout. Verifique:
```bash
grep -r "console.log\|process.stdout.write" src/ --include="*.ts" --include="*.tsx"
```

### "auth required" no primeiro uso
```bash
copilot auth
```

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `COPILOT_ORCH_LOG_DIR` | Diretório de logs (default: `~/.local/share/copilot-orch/logs`) |
| `COPILOT_ORCH_LOG_LEVEL` | Nível de log (default: info) |
| `COPILOT_ORCH_STAGGER_MS` | Delay entre spawns em ms (default: 2000) |

## Limitações conhecidas

- Maximo pratico: 3-4 agentes simultaneos (CPU e rate limit)
- Nao funciona em Windows nativo (sem WSL)
- Modo ACP auto-aprova tool calls — NAO rodar em repos nao-confiaveis
- Scroll interno por painel não existe; historico completo fica nos logs
- Rate limit e hard-fail; o retry custom ajuda mas tem limite de 3 tentativas

## Architecture Decision Log

1. **Ink em vez de tmux panes** — um único React tree simplifica estado e evita IPC
2. **simple-git via .raw() para worktrees** — sem API dedicada mas estável
3. **pino síncrono** — perde throughput mas nunca perde log em crash
4. **execa sobre child_process** — cleanup mais robusto e API mais ergonômica
5. **parseArgs nativo (não yargs)** — menos dep, suficiente para 4 flags
6. **Mock mode in-process (não binário fake)** — zero latência, controle total

## Layout

```
src/
  acp/            # tipos ACP e state machine
  agent/          # AgentSupervisor (1 por Copilot child)
  worktree/       # WorktreeManager (simple-git)
  orchestrator/   # coordena N supervisors
  ui/             # componentes Ink (App, AgentPanel, AgentGrid, StatusBar)
  logging/        # pino para arquivo
  mock/           # fake ACP stream + MockCopilotProcess
  cli.ts          # parseArgs
  index.ts        # entry point
scripts/          # setup, cleanup, reap
```
