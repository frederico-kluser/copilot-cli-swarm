---
name: testing-patterns
description: >-
  Testing patterns for this project: vitest conventions, phase machine test
  factories, WorktreeManager with real git repos in tmpdir, CLI parsing
  tests, and E2E scripts. Use when writing or modifying tests.
---
# Testing Patterns — como testar cada módulo

## Stack de testes

- **Runner:** vitest 4.1 com environment `'node'`
- **Coverage:** `@vitest/coverage-v8`
- **Config:** `vitest.config.ts` — include `src/**/*.test.ts`
- **Comandos:** `npm run test:run` (single run), `npm run test:watch` (watch mode)

## Phase Machine tests (`src/acp/__tests__/phase-machine.test.ts`)

### Factory functions

Criar SessionUpdate fixtures com factories em vez de literals:

```typescript
const thought = (text: string): SessionUpdate => ({
  sessionUpdate: 'agent_thought_chunk',
  content: { text },
});

const plan = (): SessionUpdate => ({
  sessionUpdate: 'plan',
  entries: [
    { content: 'step 1', priority: 'high', status: 'pending' },
    { content: 'step 2', priority: 'medium', status: 'pending' },
  ],
});

const toolCall = (id = 'tc1', title = 'shell'): SessionUpdate => ({
  sessionUpdate: 'tool_call',
  toolCallId: id, title, kind: 'execute', rawInput: { command: 'ls' },
});

const toolCallUpdate = (
  id = 'tc1',
  status: 'pending' | 'in_progress' | 'completed' | 'failed' = 'completed',
): SessionUpdate => ({
  sessionUpdate: 'tool_call_update', toolCallId: id, status,
});

const messageChunk = (text: string): SessionUpdate => ({
  sessionUpdate: 'agent_message_chunk',
  content: { type: 'text', text },
});

const configOptionUpdate = (currentValue = 'gpt-5'): SessionUpdate => ({
  sessionUpdate: 'config_option_update',
  configOptions: [{ id: 'model', name: 'Model', type: 'select', currentValue, ... }],
});
```

### O que testar

1. **Transições de fase:** `reducePhase(currentPhase, update) === expectedPhase`
2. **Estados absorventes:** `done` e `error` ignoram updates (exceto `config_option_update`)
3. **Acumulação de texto:** múltiplos `agent_thought_chunk` concatenam em `lastThought`
4. **Acumulação de mensagem:** múltiplos `agent_message_chunk` concatenam em `lastMessage`
5. **Deep copy:** plan entries são copiados, mutação do update original não afeta state
6. **Tool status:** sequência `tool_call` → `tool_call_update(in_progress)` → `tool_call_update(completed)` reflete em `currentTool.status`
7. **Config sem transição:** `config_option_update` atualiza `currentModel`/`currentModelLabel` sem mudar `phase`
8. **Done aceita config:** `done` + `config_option_update` → phase fica `done`, modelo atualiza

### Padrão de asserção

```typescript
it('agent_message_chunk acumula texto (3 chunks)', () => {
  let state = reduceAgentState(initialState, messageChunk('Hello '));
  state = reduceAgentState(state, messageChunk('world '));
  state = reduceAgentState(state, messageChunk('!'));
  expect(state.lastMessage).toBe('Hello world !');
  expect(state.phase).toBe('responding');
});
```

Sempre testar tanto a transição de phase quanto o campo de dados.

## WorktreeManager tests (`src/worktree/__tests__/WorktreeManager.test.ts`)

### Setup: repo real em tmpdir

```typescript
import { randomUUID } from 'node:crypto';

let testRepoDir: string;
let wm: WorktreeManager;
let defaultBranch: string;

beforeEach(async () => {
  testRepoDir = path.join(os.tmpdir(), `wt-test-${randomUUID()}`);
  fs.mkdirSync(testRepoDir, { recursive: true });
  const git = simpleGit(testRepoDir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  fs.writeFileSync(path.join(testRepoDir, 'README.md'), '# test\n');
  await git.add('.');
  await git.commit('initial commit');
  const branchSummary = await git.branchLocal();
  defaultBranch = branchSummary.current;
  wm = new WorktreeManager(testRepoDir);
});

afterEach(async () => {
  await wm.destroyAll();
  fs.rmSync(testRepoDir, { recursive: true, force: true });
});
```

### Regras obrigatórias

- **Repo real, nunca mock de git.** Testes criam repo git verdadeiro em `os.tmpdir()`.
- **randomUUID() para IDs.** Evita colisão entre runs paralelos que compartilham `/tmp/`.
- **defaultBranch detectada.** `git.branchLocal().current` — nunca hardcodar `'main'`.
- **Cleanup em afterEach.** `wm.destroyAll()` + `fs.rmSync()`. Se pular, worktrees órfãs acumulam no tmpdir.

### O que testar

1. **Create:** cria diretório e branch, retorna `WorktreeInfo` correto
2. **List:** lista worktrees excluindo a principal
3. **Destroy:** remove diretório e branch
4. **Destroy dirty (sem force):** lança `DirtyWorktreeError`
5. **Destroy dirty (com force):** limpa e remove
6. **DestroyAll:** remove todas, faz `git worktree prune`
7. **PruneOrphans:** remove worktrees cujo path não existe mais
8. **ID inválido:** rejeita IDs fora de `[a-z0-9-]`
9. **ID duplicado:** rejeita criar worktree com ID já existente

## CLI tests (`src/__tests__/cli.test.ts`)

### O que testar

```typescript
// Parsing básico
parseCli(['node', 'script', 'prompt here'])
  → { prompts: ['prompt here'], agents: 1, mock: false, interactive: false }

// Flags
parseCli(['node', 'script', '--mock', '--mock-scenario=error', 'test'])
  → { mock: true, mockScenario: 'error' }

// Interactive mode
parseCli(['node', 'script'])
  → { interactive: true, prompts: [] }

// Múltiplos prompts
parseCli(['node', 'script', '-n', '3', 'a', 'b', 'c'])
  → { agents: 3, prompts: ['a', 'b', 'c'] }

// Validação de erro
parseCli(['node', 'script', '--log-level', 'invalid'])
  → throws Error

// expandPromptsForAgents
expandPromptsForAgents(['a'], 3) → ['a', 'a', 'a']
expandPromptsForAgents(['a', 'b'], 4) → ['a', 'b', 'a', 'b']
```

## E2E tests (`src/test/`)

### Características

- **NÃO usam vitest.** São scripts standalone executados com `npx tsx`.
- **Output via stderr.** Nunca stdout (reservado para Ink em produção).
- **Inspecionam worktree.** Verificam que arquivos foram criados pelo Copilot.
- **Cleanup.** `orch.shutdown()` no final (destroys worktrees).

### Scripts disponíveis

| Script | Descrição | Uso |
|---|---|---|
| `src/test/e2e-real.ts` | 1 agente real, verifica index.txt | `npx tsx src/test/e2e-real.ts` |
| `src/test/e2e-3agents.ts` | 3 agentes reais em paralelo | `npx tsx src/test/e2e-3agents.ts` |

### Padrão E2E

```typescript
const orch = new Orchestrator({ repoDir, baseBranch });
await orch.init();
await orch.launch(tasks);
const results = await orch.waitForAll();

// Inspecionar resultados ANTES do shutdown
for (const wt of orch.worktrees) {
  // Verificar arquivos, git log, etc.
}

await orch.shutdown();
process.exit(allPassed ? 0 : 1);
```

## Convenções gerais

- **Sem mocks de git.** Sempre repos reais. Mocks de git escondem bugs de integração.
- **MockCopilotProcess para ACP.** Em vez de mockar HTTP ou child_process, usar `MockCopilotProcess` que emite NDJSON via PassThrough streams.
- **describe/it blocks.** Um describe por módulo/classe, its descritivos do comportamento.
- **Imports com .js.** Mesmo em testes: `import { X } from '../phase-machine.js'`.
- **Sem arquivos de fixture.** Factories inline nos testes. Dados são simples o suficiente.
- **Test isolation.** Cada test cria seu próprio estado. Sem dependência entre tests.

## Gotchas

- **Tests de WorktreeManager são lentos.** Criam repo git real. Vitest roda eles mas pode demorar ~5s.
- **Parallel test runs.** randomUUID nos paths evita que runs paralelas colidam no tmpdir.
- **afterEach é obrigatório.** Sem cleanup, worktrees e repos de teste acumulam indefinidamente.
- **E2E requer Copilot CLI.** Os scripts `e2e-real.ts` e `e2e-3agents.ts` precisam de `copilot` no PATH e autenticado.
- **configOptionUpdate em phase-machine tests.** Precisa simular a estrutura completa de `SessionConfigOption` (com groups).
