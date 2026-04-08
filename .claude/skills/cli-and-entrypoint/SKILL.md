---
name: cli-and-entrypoint
description: >-
  CLI argument parsing with Node 22 parseArgs, interactive wizard vs direct
  mode, entry point flow, signal handling, and help output. Use when
  modifying CLI flags, adding new options, or changing startup behavior.
---
# CLI & Entry Point — argument parsing e startup flow

## CLI (`src/cli.ts`)

### parseCli(argv)

Usa `parseArgs` nativo do Node 22 (não yargs, não commander).

```typescript
interface ParsedArgs {
  help: boolean;
  listModels: boolean;
  interactive: boolean;          // true se nenhum prompt fornecido
  mock: boolean;
  mockScenario: 'happy' | 'slow' | 'error' | 'rate_limit';
  agents: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  model?: string;
  prompts: string[];
}
```

### Flags e defaults

| Flag | Short | Type | Default | Descrição |
|---|---|---|---|---|
| `--help` | `-h` | boolean | false | Mostra help e sai |
| `--list-models` | — | boolean | false | Lista modelos disponíveis e sai |
| `--mock` | — | boolean | false | Usa MockCopilotProcess em vez de Copilot real |
| `--mock-scenario` | — | string | `'happy'` | Cenário mock: happy/slow/error/rate_limit |
| `--agents` | `-n` | string→int | len(prompts) | Número de agentes |
| `--log-level` | — | string | `'info'` | Nível de log pino |
| `--model` | — | string | undefined | Modelo inicial do Copilot |

Positionals = prompts. `strict: true` rejeita flags desconhecidas.

### Validação

- `--log-level` deve ser um de `['debug', 'info', 'warn', 'error']`
- `--mock-scenario` deve ser um de `['happy', 'slow', 'error', 'rate_limit']`
- `--agents` deve ser inteiro positivo
- `--model` é trimado; string vazia vira `undefined`

### Detecção de modo interativo

```typescript
const interactive = !values['list-models'] && prompts.length === 0;
```

Se não tem `--list-models` E não tem prompts positionals → modo interativo (wizard).

### expandPromptsForAgents(prompts, agents)

Distribui prompts para N agentes:
- 1 prompt → replicado N vezes
- M prompts → round-robin: `prompts[index % prompts.length]`

```typescript
// 1 prompt, 3 agents → ["fix bug", "fix bug", "fix bug"]
// 2 prompts, 4 agents → ["a", "b", "a", "b"]
```

### printHelp()

Output vai para `process.stderr.write()` (NUNCA stdout — Ink roda lá).

## Entry Point (`src/index.ts`)

### Flow completo do main()

```
1. parseCli(process.argv)
   └── Se --help → printHelp() → exit(0)

2. process.env['COPILOT_ORCH_LOG_LEVEL'] = parsed.logLevel

3. logger.info({ event: 'start', ... })

4. reapStalePids()
   └── Lê pids.json → para cada PID cujo parentPid está morto → SIGKILL → clearAll()

5. Se --list-models:
   └── spawn 1 AgentSupervisor → start() → getAvailableModels() → print → exit

6. Detectar branch default:
   └── simpleGit(repoDir).branchLocal().current → baseBranch

7. new Orchestrator({ repoDir, baseBranch, model, mock, mockScenario })
   └── orch.init() → pruneOrphans()

8. Se interactive:
   │  render(<App interactive onLaunch={resolve}>) → WizardScreen
   │  config = await launchPromise → builds tasks from WizardConfig
   │  orch.launch(tasks)
   │
   └── Se direct mode:
      builds tasks from CLI args
      render(<App orchestrator startedAt>)
      orch.launch(tasks)

9. results = await orch.waitForAll()

10. sleep(2000) → deixa UI mostrar estado final

11. inkInstance.unmount()

12. orch.shutdown({ preserveWorktrees: true })
    └── Worktrees preservadas para inspeção

13. Se erros → print para stderr → exit code
```

### Signal Handling

```typescript
let shuttingDown = false;

const shutdown = async (signal: 'SIGINT' | 'SIGTERM') => {
  if (shuttingDown) return;  // idempotente
  shuttingDown = true;
  inkInstance?.unmount();     // PRIMEIRO: libera terminal do raw mode
  process.stderr.write(`\n[${signal}] shutting down...\n`);
  await orch.shutdown();     // DEPOIS: cleanup de processos e worktrees
  process.exit(signal === 'SIGINT' ? 130 : 143);
};

process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
```

Ordem crítica: unmount Ink ANTES de qualquer cleanup. Senão o terminal fica em raw mode.

### Interactive mode → Wizard

```typescript
const launchPromise = new Promise<WizardConfig>((resolve) => {
  inkInstance = render(
    React.createElement(App, {
      orchestrator: orch,
      startedAt,
      interactive: true,
      onLaunch: resolve,  // callback do wizard
    }),
    { exitOnCtrlC: false },
  );
});

const config = await launchPromise;

// Build tasks from wizard config
const tasks: AgentTask[] = config.agentConfigs.map(ac => ({
  id: ac.id,
  prompt: ac.prompt,
  model: ac.model || config.model || undefined,
}));

await orch.launch(tasks);
```

### --list-models flow

Spawn temporário: cria 1 AgentSupervisor, faz handshake, lista modelos, shutdown. Output vai para stdout (único caso legítimo de stdout fora do Ink).

## Ao adicionar nova flag CLI

1. Adicionar em `parseArgs.options` em `src/cli.ts`
2. Adicionar campo em `ParsedArgs` interface
3. Validar valor no corpo de `parseCli()`
4. Adicionar no help text em `printHelp()`
5. Propagar para `OrchestratorOptions` em `src/index.ts`
6. Se flag afeta UI → propagar via Orchestrator → Supervisor → state → UI hooks
7. Se flag é novo mock scenario → adicionar em `VALID_SCENARIOS`

## Gotchas

- **parseArgs strict mode.** Flags desconhecidas lançam exceção. Catch no main() imprime erro e exit(1).
- **interactive detection.** `interactive = prompts.length === 0 && !listModels`. Se futuras flags mudarem este cálculo, atualizar a lógica.
- **exitOnCtrlC: false.** Obrigatório. Se true, Ink sai antes do cleanup coordenado.
- **reapStalePids() no startup.** Mata processos zumbi de sessões anteriores que crasharam. Verifica parentPid — só reapa se o parent original está morto.
- **baseBranch detection.** Usa `git.branchLocal().current`. Fallback para `'main'` se falha. Nunca hardcodar branch.
- **sleep(2000) antes de unmount.** Dá tempo para a UI renderizar o estado final (done/error) antes de fechar.
- **preserveWorktrees: true no exit normal.** Worktrees ficam em `/tmp/copilot-orch/agent-*` para inspeção. Próximo startup faz prune automático.
