---
name: code-review
description: >-
  Code review checklist for pull requests in this project. Checks stdout
  safety, ACP compliance, architecture boundaries, test patterns, and
  naming conventions. Use when reviewing PRs or code changes.
paths: "*.ts, *.tsx"
---
# Code Review — Checklist do Projeto

## Prioridade de verificação (nesta ordem)

### 1. Stdout safety (blocker)

- Nenhum `console.log` em código de produção (src/ exceto testes)
- Nenhum `process.stdout.write` fora de `src/mock/fake-acp-stream.ts`
- Ink `render()` é o único uso legítimo de stdout
- pino configurado com destino arquivo, nunca stdout
- Se precisa logar para debug temporário: `process.stderr.write()`

Verificar:
```bash
grep -rn "console\.log\|process\.stdout\.write" src/ --include="*.ts" --include="*.tsx" \
  | grep -v "__tests__" | grep -v "fake-acp-stream"
```

### 2. ACP compliance (blocker)

- SessionUpdate handlers usam type guards (`isToolCall()`, etc.), nunca cast manual
- Novos tipos de SessionUpdate adicionados na discriminated union em `src/acp/types.ts`
- Phase machine é pura: zero I/O, zero async, zero Date.now, zero aleatoriedade
- Phase machine sempre retorna novo objeto (spread), nunca muta input
- `done` e `error` são estados absorventes — nenhuma transição os altera

### 3. Worktree safety (blocker)

- Nunca destruir worktree onde `path === repoDir`
- IDs de worktree validados contra regex `[a-z0-9-]`
- Testes usam `randomUUID()` para IDs, nunca strings fixas
- Testes limpam em `afterEach` via `wm.destroyAll()` + `fs.rmSync(testRepoDir)`
- Branch default detectada via `git.branchLocal()`, nunca hardcoded `'main'`

### 4. Process lifecycle (blocker)

- Child processes sempre rastreados — spawn registra PID, shutdown remove
- Shutdown é idempotente (guard `shuttingDown`)
- Ordem de shutdown: unmount Ink → cancel agents → wait → SIGTERM → SIGKILL → destroy worktrees
- Pending JSON-RPC requests rejeitados na saída do child
- stderr do child capturado em buffer rolling (max 4KB)

### 5. Testes (request changes se coverage cair)

- Toda função pública nova tem pelo menos 1 teste
- Phase machine: testar transição nova com state anterior e posterior
- WorktreeManager: testes em repo real em tmpdir, nunca mocks de git
- Edge cases: null, empty, boundary values, IDs inválidos
- Verificar: `npx vitest run` — todos passando

### 6. Convenções (request changes)

- Naming: camelCase para variáveis/funções, PascalCase para classes/types/interfaces
- Arquivos: PascalCase para classes (`AgentSupervisor.ts`), kebab-case para utilitários (`pids-file.ts`)
- Error handling: classes de erro custom (ex: `DirtyWorktreeError`), nunca throw string
- Imports ESM: extensão `.js` em imports locais (ex: `'./types.js'`)
- Sem `any` explícito — usar `unknown` + type guards
- Commits: Conventional Commits (`feat:`, `fix:`, `refactor:`, etc.)

### 7. Imutabilidade (flag)

- Reducers (phase-machine) sempre retornam novo objeto via spread
- AgentState nunca mutado diretamente — sempre `{ ...state, campo: novoValor }`
- Plan entries copiados em reduceAgentState, não referenciados

## Output esperado

Produzir review estruturado com seções: **Blockers**, **Changes Requested**, **Approved**.
Cada item com: arquivo, contexto, severidade, descrição, sugestão de fix.
